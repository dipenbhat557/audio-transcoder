const OpenAI = require("openai");
const { Pinecone } = require("@pinecone-database/pinecone");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone client
const pc = new Pinecone({
	apiKey: process.env.PINECONE_API_KEY,
});

const indexName = "recording-index";

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
				dimension: 1536, // OpenAI embedding model dimension
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
	}

	async handleConnection(ws) {
		console.log("Client connected");
		
		this.transcriptionHistory.set(ws, []);

		ws.on("message", async (data) => {
			try {
				// Try to parse as JSON first
				let message;
				try {
					message = JSON.parse(data);
				} catch (e) {
					// If parsing fails, it's probably a transcript update
					return;
				}

				console.log("Received message type:", message.type);

				if (message.type === "transcript_update") {
					// Store transcript segments for summary generation later
					const currentHistory = this.transcriptionHistory.get(ws) || [];
					this.transcriptionHistory.set(ws, [...currentHistory, ...message.segments]);
				}

				if (message.type === "end_recording") {
					await this.handleEndRecording(ws);
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

		ws.on("close", () => {
			console.log("Client disconnected");
			this.transcriptionHistory.delete(ws);
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
			console.error("Error generating summary:", error);
			throw error;
		}
	}

	async storeSummaryInPinecone(summary, segments) {
		try {
			const index = pc.index(indexName);

			// Create embedding for the summary
			const summaryEmbedding = await openai.embeddings.create({
				input: summary,
				model: "text-embedding-ada-002",
			});

			// Create embeddings for each segment
			const segmentEmbeddings = await Promise.all(
				segments.map(async (segment) => {
					const embedding = await openai.embeddings.create({
						input: segment.text,
						model: "text-embedding-ada-002",
					});
					return {
						id: `segment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
						values: embedding.data[0].embedding,
						metadata: {
							type: 'segment',
							speaker: segment.speaker,
							text: segment.text,
							start: segment.start,
							end: segment.end
						}
					};
				})
			);

			// Store both summary and segment embeddings
			await index.namespace("ns1").upsert([
				{
					id: `summary-${Date.now()}`,
					values: summaryEmbedding.data[0].embedding,
					metadata: {
						type: 'summary',
						summary,
						full_transcript: segments.map(s => `${s.speaker}: ${s.text}`).join("\n")
					}
				},
				...segmentEmbeddings
			]);

		} catch (error) {
			console.error("Error storing in Pinecone:", error);
			throw error;
		}
	}

	async handleEndRecording(ws) {
		try {
			// Get all transcript segments
			const segments = this.transcriptionHistory.get(ws) || [];
			
			if (segments.length === 0) {
				throw new Error("No transcript segments found");
			}

			// Generate summary
			const summary = await this.generateSummary(segments);

			// Store in database
			const conversation = await prisma.conversation.create({
				data: {
					transcript: { segments },
					summary: summary,
				}
			});

			// Store in Pinecone
			await this.storeSummaryInPinecone(summary, segments);

			// Send summary back to client
			ws.send(
				JSON.stringify({
					type: "summary",
					summary: conversation.summary,
					segments // Send segments back for display if needed
				})
			);

			// Clear history
			this.transcriptionHistory.delete(ws);

		} catch (error) {
			console.error("Final processing error:", error);
			ws.send(
				JSON.stringify({
					type: "error",
					message: "Error generating summary",
					details: error.message
				})
			);
		}
	}
}

module.exports = new WebSocketController();
