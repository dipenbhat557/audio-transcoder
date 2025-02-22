# Conversation Recorder

This project is a conversation recording application that transcribes and summarizes audio in real-time. It utilizes Deepgram for live transcription and OpenAI for generating summaries and answering questions based on the conversation.

## Prerequisites

- Node.js (version 14 or higher)
- pnpm (install via npm: `npm install -g pnpm`)
- Access to Deepgram API and OpenAI API keys

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/dipenbhat557/audio-transcoder.git
cd audio-transcoder
```

### 2. Set Up Environment Variables

#### Frontend

1. Navigate to the frontend directory:

   ```bash
   cd frontend
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Open the `.env` file and fill in the required variables:

   ```plaintext
   VITE_DEEPGRAM_API_KEY=<your_deepgram_api_key>
   VITE_API_URL=<your_backend_api_url>
   VITE_WS_URL=<your_websocket_url>
   ```

#### Backend

1. Navigate to the backend directory:

   ```bash
   cd ../backend
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Open the `.env` file and fill in the required variables:

   ```plaintext
   PORT=<your_port>
   DATABASE_URL=<your_database_url>
   DEEPGRAM_API_KEY=<your_deepgram_api_key>
   OPENAI_API_KEY=<your_openai_api_key>
   PINECONE_API_KEY=<your_pinecone_api_key>
   PINECONE_INDEX_NAME=<your_pinecone_index_name>
   ```

### 3. Install Dependencies

#### Frontend

1. Navigate to the frontend directory (if not already there):

   ```bash
   cd frontend
   ```

2. Install the dependencies using pnpm:

   ```bash
   pnpm install
   ```

#### Backend

1. Navigate to the backend directory:

   ```bash
   cd ../backend
   ```

2. Install the dependencies using pnpm:

   ```bash
   pnpm install
   ```

3. Run database migrations:

   ```bash
   pnpx prisma migrate dev
   ```

### 4. Running the Application

#### Start the Backend

1. Navigate to the backend directory:

   ```bash
   cd backend
   ```

2. Start the backend server:

   ```bash
   pnpm dev
   ```

#### Start the Frontend

1. Open a new terminal window and navigate to the frontend directory:

   ```bash
   cd frontend
   ```

2. Start the frontend application:

   ```bash
   pnpm dev
   ```

### 5. Accessing the Application

Once both the frontend and backend are running, you can access the application in your web browser at:

```
http://localhost:5173
```

## Additional Notes

- Ensure that your API keys are kept secure and not exposed in public repositories.

## License

This project is licensed under the MIT License.