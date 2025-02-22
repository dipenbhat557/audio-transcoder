const OpenAI = require("openai");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { Pinecone } = require("@pinecone-database/pinecone");
const crypto = require("crypto");
const ffmpeg = require('fluent-ffmpeg');
const { PrismaClient } = require("@prisma/client");
const Groq = require("groq-sdk");

const prisma = new PrismaClient();
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone client
const pc = new Pinecone({
	apiKey: process.env.PINECONE_API_KEY,
});

const groq = new Groq({
	apiKey: process.env.GROQ_API_KEY,
});

const indexName = "recording-index"; // Define your index name

// Create the index if it doesn't exist
async function createIndex() {
	try {
		const existingIndexes = await pc.listIndexes();
		const indexExists = existingIndexes.indexes.filter(
			(index) => index.name === indexName
		);

		if (!indexExists.length) {
			await pc.createIndex({
				name: indexName,
				dimension: 1536, // Use the dimension of the OpenAI embedding model
				metric: "cosine",
				spec: {
					serverless: {
						cloud: "aws",
						region: "us-east-1",
					},
				},
			});
			console.log(`Index ${indexName} created successfully.`);
		} else {
			console.log(`Index ${indexName} already exists.`);
		}
	} catch (error) {
		console.error("Error creating index:", error);
	}
}

// Call createIndex when the server starts
createIndex();

class WebSocketController {
	constructor() {
		this.transcriptionHistory = new Map();
		this.lastTranscripts = new Map();
		this.sessionFiles = new Map(); // Track temp files per session
	}

	// Generate unique session-based filename
	getTempFilePath(ws, isComplete = false) {
		const sessionId = crypto.randomBytes(16).toString("hex");
		const prefix = isComplete ? "complete" : "temp";
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(7);
		return path.join(process.cwd(), "temp", `${prefix}-${sessionId}-${timestamp}-${random}.webm`);
	}

	// Ensure temp directory exists
	async ensureTempDir() {
		const tempDir = path.join(process.cwd(), "temp");
		await fs.mkdir(tempDir, { recursive: true });
		return tempDir;
	}

	async handleConnection(ws) {
		console.log("Client connected");
		await this.ensureTempDir();

		const sessionData = {
			audioChunks: [],
			lastProcessedTime: 0,
			tempFiles: new Set(),
			isProcessing: false  // Add a processing flag
		};

		this.sessionFiles.set(ws, sessionData);
		this.transcriptionHistory.set(ws, []);
		this.lastTranscripts.set(ws, "");

		ws.on("message", async (data) => {
			try {
				const message = JSON.parse(data);
				console.log("Received message type:", message.type);

				if (message.type === "audio") {
					await this.handleAudioMessage(ws, message, sessionData);
				}

				if (message.type === "end_recording") {
					await this.handleEndRecording(ws, sessionData);
				}
			} catch (error) {
				console.error("Error processing message:", error);
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Internal processing error",
					})
				);
			}
		});

		ws.on("close", async () => {
			console.log("Client disconnected");
			const sessionData = this.sessionFiles.get(ws);
			if (sessionData) {
				// Clean up all temp files for this session
				for (const filePath of sessionData.tempFiles) {
					try {
						if (await fs.access(filePath).then(() => true).catch(() => false)) {
							await fs.unlink(filePath);
							console.log(`Cleaned up file: ${filePath}`);
						}
					} catch (error) {
						console.error(`Failed to delete temp file ${filePath}:`, error);
					}
				}
			}

			this.sessionFiles.delete(ws);
			this.transcriptionHistory.delete(ws);
			this.lastTranscripts.delete(ws);
		});
	}

	async handleAudioMessage(ws, message, sessionData) {
		console.log("\n--- Handle Audio Message Start ---");
		
		const audioBuffer = Buffer.from(message.data);
		sessionData.audioChunks.push(audioBuffer);
		
		// Process audio chunks in batches for real-time transcription
		if (sessionData.audioChunks.length >= 5) {
			const tempFilePath = await this.getTempFilePath(ws);
			let readStream = null;

			try {
				// Create a copy of chunks and clear the buffer immediately
				const chunksToProcess = Buffer.concat([...sessionData.audioChunks]);
				sessionData.audioChunks = []; // Clear immediately to prevent race conditions
				
				console.log(`Writing ${chunksToProcess.length} bytes to ${tempFilePath}`);
				
				// Write the audio data with .webm extension
				const webmPath = `${tempFilePath}.webm`;
				await fs.writeFile(webmPath, chunksToProcess);
				
				// Verify the file exists and has content
				const stats = await fs.stat(webmPath);
				if (stats.size === 0) {
					throw new Error('Empty audio file created');
				}

				// Convert the audio to WAV format using ffmpeg with more detailed options
				const wavPath = `${tempFilePath}.wav`;
				await new Promise((resolve, reject) => {
					ffmpeg()
						.input(webmPath)
						.inputOptions([
							'-f webm',
							'-acodec opus'
						])
						.outputOptions([
							'-acodec pcm_s16le',
							'-ac 1',
							'-ar 16000'
						])
						.on('start', (commandLine) => {
							console.log('FFmpeg processing started:', commandLine);
						})
						.on('error', (err, stdout, stderr) => {
							console.error('FFmpeg processing error:', err);
							console.error('FFmpeg stderr:', stderr);
							reject(err);
						})
						.on('end', () => {
							console.log('FFmpeg processing completed');
							resolve();
						})
						.save(wavPath);
				});

				// Verify the WAV file was created successfully
				const wavStats = await fs.stat(wavPath);
				if (wavStats.size === 0) {
					throw new Error('Empty WAV file created');
				}

				// Create read stream from the processed WAV file
				readStream = fsSync.createReadStream(wavPath);
				
				// Use Groq API for transcription
				const transcript = await groq.audio.transcriptions.create({
					file: readStream,
					model: "whisper-large-v3-turbo",
					response_format: "verbose_json",
					language: "en",
					temperature: 0.0
				});
				
				if (transcript?.segments) {
					const segments = transcript.segments.map((segment) => ({
						speaker: "Speaker A",
						text: segment.text,
						start: segment.start,
						end: segment.end,
					}));
					
					ws.send(JSON.stringify({ type: "transcription", segments }));
					await this.indexSegmentsInPinecone(segments);
				}
				
			} catch (error) {
				console.error("Transcription error:", error);
				ws.send(JSON.stringify({ 
					type: "error", 
					message: "Failed to process audio segment" 
				}));
			} finally {
				// Clean up resources
				if (readStream) {
					readStream.destroy();
				}

				// Clean up temporary files
				const filesToDelete = [
					`${tempFilePath}.webm`,
					`${tempFilePath}.wav`
				];

				for (const file of filesToDelete) {
					try {
						if (await fs.access(file).then(() => true).catch(() => false)) {
							await fs.unlink(file);
							console.log(`Deleted temporary file: ${file}`);
						}
					} catch (error) {
						console.error(`Error deleting temp file ${file}:`, error);
					}
				}

				// Remove from tracking set
				sessionData.tempFiles.delete(tempFilePath);
			}
		}
		
		console.log("--- Handle Audio Message End ---\n");
	}

	// Function to get audio metadata using ffprobe
	async getAudioMetadata(stream) {
		return new Promise((resolve, reject) => {
			ffmpeg.ffprobe(stream, (err, metadata) => {
				if (err) {
					return reject(err);
				}
				resolve(metadata);
			});
		});
	}

	async indexSegmentsInPinecone(segments) {
		const index = pc.index(indexName); // Use the initialized index
		const vectors = await Promise.all(
			segments.map(async (segment) => {
				const embeddingResponse = await openai.embeddings.create({
					input: segment.text,
					model: "text-embedding-ada-002", // Use the appropriate embedding model
				});
				const vector = embeddingResponse.data[0].embedding; // Get the embedding vector

				return {
					id: segment.start.toString(), // Use start time as ID
					values: vector, // Use the generated vector
					metadata: { speaker: segment.speaker, text: segment.text } // Add metadata if needed
				};
			})
		);

		await index.namespace('ns1').upsert(vectors); // Use a namespace for organization
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

	async handleEndRecording(ws, sessionData) {
		try {
			const tempFilePath = await this.getTempFilePath(ws, true);
			const completeAudioBuffer = Buffer.concat(sessionData.audioChunks);

			await fs.writeFile(tempFilePath, completeAudioBuffer);
			const readStream = fsSync.createReadStream(tempFilePath);

			// Use Groq API for final transcription
			const transcript = await groq.audio.transcriptions.create({
				file: readStream,
				model: "whisper-large-v3",  // Using the full model for final transcription
				response_format: "verbose_json",
				language: "en",
				temperature: 0.0
			});

			// Process the transcript for speaker diarization
			const segments = await this.processAudioWithDiarization(transcript);
			const summary = await this.generateSummary(segments);

			// Store the summary in Pinecone
			await this.storeSummaryInPinecone(summary);

			const conversation = await prisma.conversation.create({
				data: {
					transcript: { segments },
					summary: summary,
				},
			});

			// Send final transcript
			ws.send(JSON.stringify({
				type: "final_transcript",
				segments,
			}));

			// Send summary
			ws.send(JSON.stringify({
				type: "summary",
				summary: conversation.summary,
			}));

			// Clear history
			this.transcriptionHistory.delete(ws);

			// Cleanup
			readStream.destroy();
			await fs.unlink(tempFilePath).catch(console.error);
		} catch (error) {
			console.error("Final processing error:", error);
			throw error;
		}
	}

	async generateSummary(segments) {
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
	}

	// New method to store summary in Pinecone
	async storeSummaryInPinecone(summary) {
		const index = pc.index(indexName);
		const vector = await openai.embeddings.create({
			input: summary,
			model: "text-embedding-ada-002",
		});

		await index.namespace('ns1').upsert([{
			id: Date.now().toString(), // Use a unique ID for the summary
			values: vector.data[0].embedding,
			metadata: { summary } // Store the summary as metadata
		}]);
	}
}

module.exports = new WebSocketController();
