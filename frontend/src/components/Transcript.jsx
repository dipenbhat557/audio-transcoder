import React from 'react';

const Transcript = ({ finalTranscript, transcriptHistory, summary, isRecording }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          Audio Transcript
          {isRecording && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
        </h2>
        <div className="h-96 overflow-y-auto space-y-3 custom-scrollbar">
          {finalTranscript.map((segment, index) => (
            <div 
              key={`final-${index}`} 
              className={`p-3 rounded-lg ${
                segment.speaker === 'Speaker A' 
                  ? 'bg-blue-900/50 ml-4' 
                  : 'bg-green-900/50 mr-4'
              }`}
            >
              <div className={`font-semibold mb-1 ${
                segment.speaker === 'Speaker A' ? 'text-blue-400' : 'text-green-400'
              }`}>
                {segment.speaker}
              </div>
              <div>{segment.text}</div>
            </div>
          ))}

          {isRecording && transcriptHistory.map((segment, index) => (
            <div 
              key={`interim-${index}`}
              className={`p-3 rounded-lg ${
                segment.speaker === 'Speaker A' 
                  ? 'bg-blue-900/30 ml-4' 
                  : 'bg-green-900/30 mr-4'
              } animate-pulse`}
            >
              <div className={`font-semibold mb-1 ${
                segment.speaker === 'Speaker A' ? 'text-blue-400' : 'text-green-400'
              }`}>
                {segment.speaker}
              </div>
              <div>{segment.text}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
        <h2 className="text-xl font-semibold mb-4">Summary</h2>
        <div className="prose prose-invert max-w-none">
          <div className="whitespace-pre-wrap">{summary}</div>
        </div>
      </div>
    </div>
  );
};

export default Transcript; 