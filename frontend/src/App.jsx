import React, { useState, useRef, useEffect } from "react";
import Header from "./components/Header";
import RecordingButton from "./components/RecordingButton";
import Transcript from "./components/Transcript";
import ChatAssistant from "./components/ChatAssistant";
import Loader from "./components/Loader";

const App = () => {
	const [isRecording, setIsRecording] = useState(false);
	const [transcriptHistory, setTranscriptHistory] = useState([]);
	const [summary, setSummary] = useState("");
	const [isConnected, setIsConnected] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [recordingTime, setRecordingTime] = useState(0);
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [questionHistory, setQuestionHistory] = useState([]);
	const [activeTab, setActiveTab] = useState("transcript");
	const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);

	const wsRef = useRef(null);
	const timerRef = useRef(null);

	useEffect(() => {
		connectWebSocket();
		window.scrollTo(0, 0);
		if (transcriptHistory.length === 0) {
			localStorage.removeItem("conversationNamespace");
		}
		return () => {
			if (wsRef.current) wsRef.current.close();
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, []);

  const mergeTranscripts = (segments) => {
    console.log('\n--- Merging Transcripts ---');
    console.log('Input segments:', segments.length);

    const merged = segments.reduce((acc, curr) => {
      const last = acc[acc.length - 1];

      console.log("last", last);
      console.log("curr", curr);

      if (last && last.speaker === curr.speaker && 
          curr.start - last.end < 2.0) {
        console.log('Merging segment with previous:', {
          prev: last.text,
          curr: curr.text
        });
        // Merge with previous segment
        last.text = `${last.text} ${curr.text}`;
        last.end = curr.end;
        last.words = [...last.words, ...curr.words];
        // last.words = [...last.text, ...curr.text];
        return acc;
      }

      // Add as new segment
      console.log('Adding new segment:', curr.text);
      return [...acc, { ...curr }];
    }, []);

    console.log("merged", merged);
    return merged;
  };

	const connectWebSocket = () => {
		const ws = new WebSocket(
			import.meta.env.VITE_WS_URL || "ws://localhost:3000"
		);

		ws.onopen = () => {
			setIsConnected(true);
		};

		ws.onmessage = (event) => {
			const message = JSON.parse(event.data);
			console.log("message", message);

			switch (message.type) {
        case "final_transcript":
          setTranscriptHistory(mergeTranscripts(message.segments));
				case "summary":
					setSummary(message.summary);
					setIsProcessing(false);
					break;
				case "error":
					setIsProcessing(false);
					break;
			}
		};

		ws.onclose = () => {
			setIsConnected(false);
			setTimeout(connectWebSocket, 3000);
		};

		wsRef.current = ws;
	};

	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-8">
			<div className="max-w-4xl mx-auto space-y-8">
				<Header />
				<RecordingButton
					isRecording={isRecording}
					setIsRecording={setIsRecording}
					isConnected={isConnected}
					isProcessing={isProcessing}
					setIsProcessing={setIsProcessing}
					recordingTime={recordingTime}
					setRecordingTime={setRecordingTime}
					wsRef={wsRef}
					transcriptHistory={transcriptHistory}
					setTranscriptHistory={setTranscriptHistory}
					setSummary={setSummary}
				/>
				<div className="flex space-x-4 border-b border-gray-700">
					<button
						onClick={() => setActiveTab("transcript")}
						className={`px-4 cursor-pointer py-2 font-medium transition-colors ${
							activeTab === "transcript"
								? "tab-active"
								: "text-gray-400 hover:text-white"
						}`}
					>
						Transcript & Summary
					</button>
					<button
						onClick={() => setActiveTab("chat")}
						className={`px-4 cursor-pointer py-2 font-medium transition-colors ${
							activeTab === "chat"
								? "tab-active"
								: "text-gray-400 hover:text-white"
						}`}
					>
						Chat Assistant
					</button>
				</div>
				{activeTab === "transcript" ? (
					<Transcript
						transcriptHistory={transcriptHistory}
						summary={summary}
						isRecording={isRecording}
					/>
				) : (
					<ChatAssistant
						question={question}
						setQuestion={setQuestion}
						questionHistory={questionHistory}
						setQuestionHistory={setQuestionHistory}
						isGeneratingAnswer={isGeneratingAnswer}
						setIsGeneratingAnswer={setIsGeneratingAnswer}
						setAnswer={setAnswer}
					/>
				)}
				{isProcessing && <Loader />}
			</div>
		</div>
	);
};

export default App;
