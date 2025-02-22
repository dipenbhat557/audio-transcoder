import React, { useRef } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';
import Loader from './Loader';

const RecordingButton = ({ isRecording, setIsRecording, isConnected, isProcessing, recordingTime, setRecordingTime, wsRef, setTranscriptHistory, setFinalTranscript, setSummary }) => {
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const timerRef = useRef(null);

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
      
      // Specify the correct MIME type and codec
      const options = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      };
      
      mediaRecorder.current = new MediaRecorder(stream, options);
      audioChunks.current = [];
      setRecordingTime(0);
      setTranscriptHistory([]);
      setFinalTranscript([]);
      setSummary('');

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.current.push(event.data);
          event.data.arrayBuffer().then(buffer => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ 
                type: 'audio', 
                data: Array.from(new Uint8Array(buffer)),
                format: 'webm',
                codec: 'opus'
              }));
            }
          });
        }
      };

      mediaRecorder.current.onstop = () => {
        clearInterval(timerRef.current);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'end_recording' }));
        }
      };

      mediaRecorder.current.start(1000);
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
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