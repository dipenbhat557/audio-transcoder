const { pc, indexName, openai, prisma } = require("../config");
const path = require("path");
const fs = require("fs");
const fsSync = require("fs").promises;
const OpenAI = require('openai');

async function createIndex() {
	try {
		const existingIndexes = await pc.listIndexes();
		const indexExists = existingIndexes.indexes.filter(
			(index) => index.name === indexName
		);

		if (!indexExists.length) {
			await pc.createIndex({
				name: indexName,
				dimension: 1536,
				metric: "cosine",
				spec: {
					serverless: {
						cloud: "aws",
						region: "us-east-1",
					},
				},
			});
		}
	} catch (error) {
		console.error("Error creating index:", error);
	}
}

createIndex();

class WebSocketController {
	constructor() {
		this.transcriptionHistory = new Map();
	}

	async handleConnection(ws) {
		this.transcriptionHistory.set(ws, []);
		let audioChunks = [];

		ws.on("message", async (data) => {
			try {
				let message;
				try {
					message = JSON.parse(data);
				} catch (e) {
					return;
				}

				if (message.type === "audio_message") {
					await this.handleAudioMessage(ws, message, audioChunks);
				}

				if (message.type === "end_recording") {
					await this.handleEndRecording(ws, audioChunks, message.namespace);
				}
			} catch (error) {
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Internal processing error",
					})
				);
			}
		});

		ws.on("close", () => {
			this.transcriptionHistory.delete(ws);
		});
	}

	async processAudioWithDiarization(audioFile) {
		const transcript = await openai.audio.transcriptions.create({
			file: audioFile,
			model: "whisper-1",
			response_format: "verbose_json",
			timestamp_granularities: ["segment", "word"],
			temperature: 0.2,
			language: "en",
		});

		if (!transcript.segments) return [];

		const BATCH_SIZE = 3;
		const processedSegments = [];

		for (let i = 0; i < transcript.segments.length; i += BATCH_SIZE) {
			const batch = transcript.segments.slice(i, i + BATCH_SIZE);

			try {
				const completion = await openai.completions.create({
					model: "gpt-3.5-turbo-instruct",
					prompt: `Analyze these conversation segments and assign speakers.
	Previous speaker: ${i > 0 ? processedSegments[i - 1]?.speaker : "none"}
	${JSON.stringify(batch, null, 2)}

Return a valid JSON object like this example (use exact format):
{
  "segments": [
    {
      "speaker": "Speaker A",
      "text": "Hello there",
      "start": 0.0,
      "end": 1.2
    }
  ]
}`,
					max_tokens: 500,
					temperature: 0.3,
					stop: ["}}", "```"],
				});

				// Clean and parse the response
				let cleanedResponse = completion.choices[0].text.trim();
				// Ensure the response starts with { and ends with }
				const startBrace = cleanedResponse.indexOf("{");
				const endBrace = cleanedResponse.lastIndexOf("}");
				if (startBrace !== -1 && endBrace !== -1) {
					cleanedResponse = cleanedResponse.slice(startBrace, endBrace + 1);
				}

				const gptAnalysis = JSON.parse(cleanedResponse);

				if (gptAnalysis?.segments) {
					// Maintain speaker consistency
					const batchSegments = gptAnalysis.segments.map((segment, index) => {
						if (index === 0 && i > 0) {
							const lastProcessed =
								processedSegments[processedSegments.length - 1];
							const timeGap =
								(segment.start || segment.start_time) -
								(lastProcessed.end || lastProcessed.end_time);
							if (timeGap < 1.0) {
								return { ...segment, speaker: lastProcessed.speaker };
							}
						}
						return segment;
					});
					processedSegments.push(...batchSegments);
				}
			} catch (e) {
				console.error(
					"Failed to parse GPT analysis for batch, using simple detection:",
					e
				);
				const detectedSegments = this.detectSpeakerChanges(
					batch,
					i > 0 ? processedSegments[processedSegments.length - 1] : null
				);
				processedSegments.push(...detectedSegments);
			}

			// Add delay between batches
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		return processedSegments.map((segment) => ({
			speaker: segment.speaker || "Speaker B",
			text: segment.text,
			start: segment.start || segment.start_time,
			end: segment.end || segment.end_time,
			words: segment.words || [],
			confidence: segment.confidence,
		}));
	}

	detectSpeakerChanges(segments, lastProcessedSegment = null) {
		return segments.map((segment, index) => {
			// First segment of all
			if (!lastProcessedSegment && index === 0) {
				return { ...segment, speaker: "Speaker A" };
			}

			const prevSegment =
				index === 0 ? lastProcessedSegment : segments[index - 1];
			const timeGap =
				(segment.start || segment.start_time) -
				(prevSegment.end || prevSegment.end_time);
			const prevSpeaker = prevSegment.speaker;

			const discourseMarkers = [
				"but",
				"well",
				"so",
				"okay",
				"right",
				"um",
				"uh",
			];
			const startsWithMarker = discourseMarkers.some((marker) =>
				segment.text.toLowerCase().trim().startsWith(marker)
			);

			const shouldChangeSpeaker = timeGap > 1.0 || startsWithMarker;
			const speaker = shouldChangeSpeaker
				? prevSpeaker === "Speaker A"
					? "Speaker B"
					: "Speaker A"
				: prevSpeaker;

			return { ...segment, speaker };
		});
	}

	async generateSummary(segments) {
		try {
			const completion = await openai.chat.completions.create({
				model: "gpt-3.5-turbo",
				messages: [
					{
						role: "system",
						content:
							"Analyze the following conversation and provide: 1) A brief summary 2) Key points discussed 3) Any action items or decisions made",
					},
					{
						role: "user",
						content: segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
					},
				],
			});

			return completion.choices[0].message.content;
		} catch (error) {
			throw error;
		}
	}

	async storeSummaryInPinecone(summary, segments, namespace) {
		try {
			const index = pc.index(indexName);

			const summaryEmbedding = await openai.embeddings.create({
				input: summary,
				model: "text-embedding-ada-002",
			});

			const segmentEmbeddings = await Promise.all(
				segments.map(async (segment) => {
					try {
						const embedding = await openai.embeddings.create({
							input: segment.text,
							model: "text-embedding-ada-002",
						});
						return {
							id: `segment-${Date.now()}-${Math.random()
								.toString(36)
								.substr(2, 9)}`,
							values: embedding.data[0].embedding,
							metadata: {
								type: "segment",
								speaker: segment.speaker,
								text: segment.text,
								start: segment.start,
								end: segment.end,
							},
						};
					} catch (e) {
						console.error("Error creating embedding for segment:", segment, e);
						return null;
					}
				})
			);

			// Filter out any null values from segmentEmbeddings
			const validSegmentEmbeddings = segmentEmbeddings.filter(Boolean);

			// Log the data being sent to Pinecone
			console.log("Upserting to Pinecone:", {
				summaryEmbedding,
				validSegmentEmbeddings,
			});

			await index.namespace(namespace).upsert([
				{
					id: `summary-${Date.now()}`,
					values: summaryEmbedding.data[0].embedding,
					metadata: {
						type: "summary",
						summary,
						full_transcript: segments
							.map((s) => `${s.speaker}: ${s.text}`)
							.join("\n"),
					},
				},
				...validSegmentEmbeddings,
			]);
		} catch (error) {
			console.error("Error storing in Pinecone:", error);
			throw error;
		}
	}

	async handleAudioMessage(ws, message, audioChunks) {
		const audioBuffer = Buffer.from(message.data);
		audioChunks.push(audioBuffer);
	}

	async handleEndRecording(ws, audioChunks, namespace) {
		try {
			console.log("Starting handleEndRecording with namespace:", namespace);
			console.log("Audio chunks received:", audioChunks.length);

			const tempFilePath = path.join(
				__dirname,
				`../complete-${Date.now()}.webm`
			);
			console.log("Temporary file path:", tempFilePath);

			const completeAudioBuffer = Buffer.concat(audioChunks);
			console.log("Complete audio buffer size:", completeAudioBuffer.length);

			await fsSync.writeFile(tempFilePath, completeAudioBuffer);
			console.log("Audio file written to disk");

			console.log("Audio buffer details:", {
				size: completeAudioBuffer.length,
				exists: !!completeAudioBuffer
			  });
			  
			  // Create readable stream and check it
			  const audioStream = fs.createReadStream(tempFilePath);
			  console.log("Audio stream created:", {
				path: tempFilePath,
				readable: audioStream.readable
			  });

			const audioFile = await OpenAI.toFile(
				fs.createReadStream(tempFilePath),
				"audio.webm",
				{
					purpose: "transcription",
				}
			);
			console.log("Audio file converted for OpenAI");

			console.log("Starting audio processing with diarization...");
			console.log("Audio file:", audioFile);
			const segments = await this.processAudioWithDiarization(audioFile);
			console.log("Audio processing complete. Segments:", segments.length);

			if (segments.length === 0) {
				console.error("No segments found in processed audio");
				throw new Error("No transcript segments found");
			}

			console.log("Generating summary from segments...");
			const summary = await this.generateSummary(segments);
			console.log("Summary generated:", summary);

			console.log("Creating conversation in database...");
			const conversation = await prisma.conversation.create({
				data: {
					transcript: { segments },
					summary: summary,
				},
			});
			console.log("Conversation created with ID:", conversation.id);

			console.log("Storing summary in Pinecone...");
			await this.storeSummaryInPinecone(summary, segments, namespace);
			console.log("Summary stored in Pinecone successfully");

			console.log("Sending final transcript to client...");
			ws.send(
				JSON.stringify({
					type: "final_transcript",
					segments,
				})
			);

			console.log("Sending summary to client...");
			ws.send(
				JSON.stringify({
					type: "summary",
					summary: conversation.summary,
					segments,
				})
			);

			this.transcriptionHistory.delete(ws);
			console.log("Transcription history cleared for websocket");
		} catch (error) {
			console.error("Error in handleEndRecording:", error);
			ws.send(
				JSON.stringify({
					type: "error",
					message: "Error generating summary",
					details: error.message,
				})
			);
		}
	}
}

module.exports = new WebSocketController();
