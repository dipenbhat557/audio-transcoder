const { pc, indexName, openai } = require("../config");
const { Router } = require("express");

const router = Router();

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
			`Answer the user's question directly based on the summaries below. Be brief and to the point:\n\n` +
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

module.exports = router;
