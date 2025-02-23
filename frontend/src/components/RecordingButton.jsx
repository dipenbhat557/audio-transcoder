import React, { useRef, useState } from "react";
import { FaMicrophone, FaStop } from "react-icons/fa";
import Loader from "./Loader";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { v4 as uuidv4 } from "uuid";
const RecordingButton = ({
	isRecording,
	setIsRecording,
	isConnected,
	isProcessing,
	setIsProcessing,
	recordingTime,
	setRecordingTime,
	transcriptHistory,
	setTranscriptHistory,
	setSummary,
	wsRef,
}) => {
	const mediaRecorder = useRef(null);
	const timerRef = useRef(null);
	const deepgramLive = useRef(null);
  const audioChunks = useRef([]);

	const formatTime = (seconds) => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	};

	const startRecording = async () => {
		try {
			console.log("Starting recording...");
			setTranscriptHistory([]);
			setSummary("");
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					sampleRate: 16000,
					echoCancellation: true,
					noiseSuppression: true,
				},
			});

			const options = {
				mimeType: "audio/webm;codecs=opus",
				audioBitsPerSecond: 128000,
			};

			const deepgram = createClient(import.meta.env.VITE_DEEPGRAM_API_KEY);

			deepgramLive.current = deepgram.listen.live({
				model: "nova-3",
				language: "en",
				smart_format: true,
				interim_results: true,
				diarize: true,
			});

			let isDeepgramReady = false;
			deepgramLive.current.on(LiveTranscriptionEvents.Open, () => {
				console.log("Connected to Deepgram");
				isDeepgramReady = true;
			});

			deepgramLive.current.on(LiveTranscriptionEvents.Close, () => {
				console.log("Disconnected from Deepgram");
				isDeepgramReady = false;
			});

			deepgramLive.current.on(LiveTranscriptionEvents.Transcript, (data) => {
				if (data.channel?.alternatives?.[0]) {
					const transcript = data.channel.alternatives[0];

					if (!transcript.words || transcript.words.length === 0) {
						console.warn("Received empty transcript.");
						return;
					}
					setTranscriptHistory(prev => {
						if (JSON.stringify(transcript.words) !== JSON.stringify(prev[prev.length-1]?.words)) {
							if (transcript.words.some(word => prev[prev.length-1]?.words.some(lastWord => lastWord.word === word.word))) {
								const newPrev = prev.filter((_, i) => i !== prev.length - 1);
								return [...newPrev, {
									text: transcript.transcript,
									speaker: `Speaker ${transcript.words[0].speaker + 1}`,
									start: transcript.words[0].start,
									end: transcript.words[transcript.words.length - 1].end,
									words: transcript.words,
								}];
							} else {
								return [...prev, {
									text: transcript.transcript,
									speaker: `Speaker ${transcript.words[0].speaker + 1}`,
									start: transcript.words[0].start,
									end: transcript.words[transcript.words.length - 1].end,
									words: transcript.words,
								}];
							}
						}
						return prev;
					});

					if (wsRef.current?.readyState === WebSocket.OPEN) {
						wsRef.current.send(JSON.stringify({
							type: "transcript_update",
							segments: [{
								text: transcript.transcript,
								speaker: `Speaker ${transcript.words[0].speaker +1}`,
								start: transcript.words[0].start,
								end: transcript.words[transcript.words.length - 1].end,
								words: transcript.words,
							}]
						}));
					}
				} else {
					console.warn("No alternatives found in transcript data.");
				}
			});

			deepgramLive.current.on(LiveTranscriptionEvents.Error, (error) => {
				console.error("Deepgram error:", error);
			});

			deepgramLive.current.on(LiveTranscriptionEvents.Warning, (warning) => {
				console.warn("Deepgram warning:", warning);
			});

			mediaRecorder.current = new MediaRecorder(stream, options);
			setRecordingTime(0);

			timerRef.current = setInterval(() => {
				setRecordingTime((prev) => prev + 1);
			}, 1000);

			mediaRecorder.current.ondataavailable = (event) => {
				if (event.data.size > 0) {

          audioChunks.current.push(event.data);
          event.data.arrayBuffer().then(buffer => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'audio_message',
                data: Array.from(new Uint8Array(buffer))
              }));
            }
          });

					const reader = new FileReader();
					reader.onloadend = () => {
						if (
							isDeepgramReady &&
							deepgramLive.current?.getReadyState() === 1
						) {
							try {
								deepgramLive.current.send(reader.result);
								deepgramLive.current.keepAlive();
							} catch (error) {
								console.error("Error sending audio to Deepgram:", error);
							}
							if (wsRef.current?.readyState === WebSocket.OPEN) {
								wsRef.current.send(reader.result);
							}
						} else {
							console.warn(
								"Deepgram connection is not ready to send data. Ready state:",
								deepgramLive.current?.getReadyState()
							);
						}
					};
					reader.readAsArrayBuffer(event.data);
				}
			};

			mediaRecorder.current.onstop = () => {
				clearInterval(timerRef.current);
				if (deepgramLive.current) {
					deepgramLive.current.requestClose();
				}
				const namespace = uuidv4();
				localStorage.setItem("conversationNamespace", namespace);

				if (wsRef.current?.readyState === WebSocket.OPEN) {
					wsRef.current.send(
						JSON.stringify({ type: "end_recording", namespace })
					);
				}
				setIsRecording(false);
				setIsProcessing(true);
			};

			mediaRecorder.current.start(1000);
			setIsRecording(true);
			setIsProcessing(false);
		} catch (error) {
			console.error("Error starting recording:", error);
			setIsProcessing(false);
		}
	};

	const stopRecording = () => {
		console.log("Stopping recording...");
		if (mediaRecorder.current && isRecording) {
			mediaRecorder.current.stop();
		}
	};

	return (
		<div className="flex flex-col items-center gap-6">
			<div className="relative">
				<button
					onClick={isRecording ? stopRecording : startRecording}
					disabled={!isConnected || isProcessing}
					className={`
            w-24 h-24 rounded-full flex items-center justify-center
            transition-all duration-300 transform hover:scale-105
            ${
							!isConnected
								? "bg-gray-600 cursor-not-allowed"
								: isRecording
								? "bg-red-500 hover:bg-red-600"
								: "bg-blue-500 hover:bg-blue-600"
						}
          `}
				>
					{isRecording ? (
						<FaStop className="w-8 h-8" />
					) : (
						<FaMicrophone className="w-8 h-8" />
					)}
				</button>
				<div
					className={`absolute -top-2 -right-2 w-4 h-4 rounded-full 
          ${isConnected ? "bg-green-500" : "bg-red-500"}`}
				/>
			</div>
			{isRecording && (
				<div className="text-2xl font-mono text-red-500">
					{formatTime(recordingTime)}
				</div>
			)}
			{isProcessing && <Loader />}
		</div>
	);
};

export default RecordingButton;
