import React, { useState, useCallback } from 'react';

interface ResultsDisplayProps {
  output: string;
}

// Heroicon: ClipboardDocument
const ClipboardDocumentIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M11.47 1.72a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.72-1.72H6a.75.75 0 0 1 0-1.5h7.19l-1.72-1.72a.75.75 0 0 1 0-1.06Zm-2.22 8.92a.75.75 0 0 0-1.06 0l-3 3a.75.75 0 0 0 0 1.06l3 3a.75.75 0 1 0 1.06-1.06l-1.72-1.72H15a.75.75 0 0 0 0-1.5H7.53l1.72-1.72a.75.75 0 0 0 0-1.06ZM18.75 3.75A2.25 2.25 0 0 0 16.5 1.5h-9A2.25 2.25 0 0 0 5.25 3.75v16.5A2.25 2.25 0 0 0 7.5 22.5h9a2.25 2.25 0 0 0 2.25-2.25V3.75Z" clipRule="evenodd" />
  </svg>
);

// Heroicon: CheckCircle (for copied state)
const CheckCircleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.06-1.06l-3.002 3.001-1.502-1.502a.75.75 0 0 0-1.06 1.061l2.002 2.002a.75.75 0 0 0 1.06 0l3.502-3.502Z" clipRule="evenodd" />
    </svg>
);

// Heroicon: QueueListIcon
const QueueListIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M3 6.75A.75.75 0 0 1 3.75 6h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 6.75ZM3 12a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 12Zm0 5.25a.75.75 0 0 1 .75-.75H12a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
  </svg>
);


export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ output }) => {
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedAnswersOnly, setCopiedAnswersOnly] = useState(false);

  const handleCopyFull = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopiedFull(true);
      setCopiedAnswersOnly(false); // Reset other button's state
      setTimeout(() => setCopiedFull(false), 2000);
    } catch (err) {
      console.error('Failed to copy full output: ', err);
      alert('Failed to copy to clipboard. Please ensure you are on a secure connection (HTTPS) or localhost.');
    }
  }, [output]);

  const handleCopyAnswersOnly = useCallback(async () => {
    if (!output) return;
    try {
      const answers = output
        .split(',')
        .map(pair => {
          const parts = pair.trim().split('-');
          return parts.length > 1 ? parts[1].trim() : ''; // Get the part after '-'
        })
        .filter(answer => answer !== '') // Filter out any empty strings if a pair was malformed
        .join('\n');

      if (answers) {
        await navigator.clipboard.writeText(answers);
        setCopiedAnswersOnly(true);
        setCopiedFull(false); // Reset other button's state
        setTimeout(() => setCopiedAnswersOnly(false), 2000);
      } else {
        alert('No answers found in the current format to copy separately.');
      }
    } catch (err) {
      console.error('Failed to copy answers only: ', err);
      alert('Failed to copy answers to clipboard. Please ensure you are on a secure connection (HTTPS) or localhost.');
    }
  }, [output]);

  return (
    <div className="p-4 md:p-6 bg-slate-700/70 rounded-lg shadow-lg">
      <h2 className="text-xl font-semibold text-sky-300 mb-3">Formatted Answer Key:</h2>
      <div className="relative group">
        <pre className="bg-slate-800 p-4 rounded-md text-slate-200 text-sm whitespace-pre-wrap break-all overflow-x-auto max-h-60">
          {output || "No results to display."}
        </pre>
        <div className="absolute top-2 right-2 flex space-x-1.5">
            <button
                onClick={handleCopyAnswersOnly}
                title={copiedAnswersOnly ? "Answers Copied!" : "Copy Answers (for column paste)"}
                className={`p-1.5 rounded-md transition-all duration-150 ease-in-out
                            ${copiedAnswersOnly ? 'bg-emerald-500 text-white' : 'bg-slate-600 hover:bg-sky-600 text-slate-300 hover:text-white opacity-50 group-hover:opacity-100'}`}
                aria-label={copiedAnswersOnly ? "Answers copied to clipboard" : "Copy answers only for column pasting"}
                disabled={!output}
            >
                {copiedAnswersOnly ? <CheckCircleIcon className="w-5 h-5" /> : <QueueListIcon className="w-5 h-5" />}
            </button>
            <button
                onClick={handleCopyFull}
                title={copiedFull ? "Copied!" : "Copy full key"}
                className={`p-1.5 rounded-md transition-all duration-150 ease-in-out
                            ${copiedFull ? 'bg-emerald-500 text-white' : 'bg-slate-600 hover:bg-sky-600 text-slate-300 hover:text-white opacity-50 group-hover:opacity-100'}`}
                aria-label={copiedFull ? "Full key copied to clipboard" : "Copy full answer key"}
                disabled={!output}
            >
                {copiedFull ? <CheckCircleIcon className="w-5 h-5" /> : <ClipboardDocumentIcon className="w-5 h-5" />}
            </button>
        </div>
      </div>
    </div>
  );
};