import React, { useRef } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';
import Loader from './Loader';
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

const RecordingButton = ({ 
  isRecording, 
  setIsRecording, 
  isConnected, 
  isProcessing, 
  setIsProcessing,
  recordingTime,
  setRecordingTime,
  setTranscriptHistory,
  wsRef // Reference to the local WebSocket
}) => {
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const timerRef = useRef(null);
  const deepgramLive = useRef(null);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      const options = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      };

      // Initialize Deepgram client
      const deepgram = createClient(import.meta.env.VITE_DEEPGRAM_API_KEY);
      
      // Create live transcription instance
      deepgramLive.current = deepgram.listen.live({
        model: "nova-3",
        language: "en",
        smart_format: true,
        interim_results: true,
        diarize: true
      });

      // Set up event listeners
      deepgramLive.current.on(LiveTranscriptionEvents.Open, () => {
        console.log("Connected to Deepgram");
      });

      deepgramLive.current.on(LiveTranscriptionEvents.Transcript, (data) => {
        console.log("Received transcript:", data);
        if (data.channel?.alternatives?.[0]) {
          const transcript = data.channel.alternatives[0];
          const segments = [{
            speaker: "Speaker A",
            text: transcript.transcript,
            start: data.start || 0,
            end: (data.start || 0) + (data.duration || 0),
            words: transcript.words || []
          }];
          
          setTranscriptHistory(prev => [...prev, ...segments]);
          
          // Send to backend for storage
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: "transcript_update",
              segments
            }));
          }
        }
      });

      deepgramLive.current.on(LiveTranscriptionEvents.Error, (error) => {
        console.error("Deepgram error:", error);
      });

      deepgramLive.current.on(LiveTranscriptionEvents.Warning, (warning) => {
        console.warn("Deepgram warning:", warning);
      });

      mediaRecorder.current = new MediaRecorder(stream, options);
      audioChunks.current = [];
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
          const reader = new FileReader();
          reader.onloadend = () => {
            if (deepgramLive.current?.getReadyState() === 1) { // 1 = OPEN
              deepgramLive.current.send(reader.result); // Send audio data to Deepgram
              deepgramLive.current.keepAlive();
              // Send audio data to local WebSocket for storage
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(reader.result); // Send audio data to local WS
              }
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
        setIsRecording(false);
        setIsProcessing(true);
      };

      mediaRecorder.current.start(1000);
      setIsRecording(true);
      setIsProcessing(false);
    } catch (error) {
      console.error('Error starting recording:', error);
      setIsProcessing(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
        mediaRecorder.current.stop();
        // Do not clear transcript history here
        setIsRecording(false);
        setIsProcessing(true);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'end_recording' }));
        }
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
            ${!isConnected 
              ? 'bg-gray-600 cursor-not-allowed'
              : isRecording 
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-blue-500 hover:bg-blue-600'
            }
          `}
        >
          {isRecording ? (
            <FaStop className="w-8 h-8" />
          ) : (
            <FaMicrophone className="w-8 h-8" />
          )}
        </button>
        <div className={`absolute -top-2 -right-2 w-4 h-4 rounded-full 
          ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
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