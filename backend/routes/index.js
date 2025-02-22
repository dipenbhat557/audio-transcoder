const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const multer = require("multer");
const { Pinecone } = require("@pinecone-database/pinecone");

dotenv.config();

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

router.post("/query", async (req, res) => {
	const {  question, namespace } = req.body;

  const embeddingResponse = await openai.embeddings.create({
    input: question,
    model: "text-embedding-ada-002",
  });

  const vector = embeddingResponse.data[0].embedding;

	try {
		const index = pc.index(indexName);
		const queryResponse = await index.namespace(namespace).query({
			vector,
			topK: 5,
			includeValues: false,
			includeMetadata: true,
		});

		const results = queryResponse.matches.map((match) => ({
			id: match.id,
			score: match.score,
			summary: match.metadata.summary,
		}));

		const prompt =
			`Based on the following summaries, provide a detailed answer to the user's question. Do not include any other text than the answer. Keep it short and concise:\n\n` +
			`User's question: ${req.body.question}\n\n` +
			`Summaries:\n${results.map((r) => r.summary).join("\n")}`;

		const completion = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [{ role: "user", content: prompt }],
		});

		const answer = completion.choices[0].message.content;


		res.json({ results, answer });
	} catch (error) {
		console.log("error", error);
		res.status(500).json({ error: error.message });
	}
});

router.use((error, req, res, next) => {
	if (error instanceof multer.MulterError) {
		return res.status(400).json({
			error: "File upload error",
			details: error.message,
		});
	} else if (error) {
		return res.status(400).json({
			error: "Invalid file type",
			details: error.message,
		});
	}
	next();
});

module.exports = router;
