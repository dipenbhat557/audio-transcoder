const OpenAI = require("openai");
const { Pinecone } = require("@pinecone-database/pinecone");
const { PrismaClient } = require("@prisma/client");

const pc = new Pinecone({
	apiKey: process.env.PINECONE_API_KEY,
});

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

const indexName = "recording-index";

const prisma = new PrismaClient();

module.exports = { pc, openai, indexName, prisma };
