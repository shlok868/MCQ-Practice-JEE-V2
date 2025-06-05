
import React, { useState, useCallback } from 'react';
import { ExtractedAnswer } from './types';
import { extractAnswersFromImage } from './services/geminiService';
import { ImageUploadArea } from './components/ImageUploadArea';
import { ResultsDisplay } from './components/ResultsDisplay';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { Button } from './components/Button';

// Heroicon: DocumentArrowUp (for Upload)
const DocumentArrowUpIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M10.5 3.75a2.25 2.25 0 0 0-2.25 2.25v10.19l-1.72-1.72a.75.75 0 0 0-1.06 1.06l3 3a.75.75 0 0 0 1.06 0l3-3a.75.75 0 1 0-1.06-1.06l-1.72 1.72V6a2.25 2.25 0 0 0-2.25-2.25Z" clipRule="evenodd" />
    <path d="M12.75 5.032A2.25 2.25 0 0 0 10.5 6v10.19l-1.72-1.72a.75.75 0 0 0-1.06 1.06l3 3a.75.75 0 0 0 1.06 0l3-3a.75.75 0 1 0-1.06-1.06L12.75 16.19V6c0-.49-.156-.943-.43-1.312A2.233 2.233 0 0 0 12.75 5.032ZM12 0A12 12 0 1 0 12 24 12 12 0 0 0 12 0Zm0 22.5a10.5 10.5 0 1 1 0-21 10.5 10.5 0 0 1 0 21Z" />
  </svg>
);

// Heroicon: Sparkles (for Process)
const SparklesIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69a.75.75 0 0 1 .981.981l-1.327 1.327a.75.75 0 0 1-1.06 0l-1.95-1.95a.75.75 0 0 1 0-1.06l1.327-1.327a.75.75 0 0 1 .981.981A8.97 8.97 0 0 0 18 15.001a9 9 0 0 0-9-9 8.97 8.97 0 0 0-3.463.69.75.75 0 0 1-.981-.981l1.327-1.327a.75.75 0 0 1 1.06 0l1.95 1.95a.75.75 0 0 1 0 1.06L9.528 3.046a.75.75 0 0 1-.162-.819Zm9.191 14.002a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 18.001 21a9 9 0 0 0-9-9 8.97 8.97 0 0 0-3.463.69.75.75 0 0 1-.981-.981l1.327-1.327a.75.75 0 0 1 1.06 0l1.95 1.95a.75.75 0 0 1 0 1.06l-1.327 1.327a.75.75 0 0 1-.981.981A8.97 8.97 0 0 0 9 18.001a9 9 0 0 0 9-9 8.97 8.97 0 0 0-3.463-.69.75.75 0 0 1-.981-.981l1.327-1.327a.75.75 0 0 1 1.06 0l1.95 1.95a.75.75 0 0 1 0 1.06l-1.327 1.327a.75.75 0 0 1-.981.981Z" clipRule="evenodd" />
    </svg>
);


const App: React.FC = () => {
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [transformedOutput, setTransformedOutput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const LETTER_TO_NUMBER_MAP: { [key: string]: number } = {
    'a': 1, 'b': 2, 'c': 3, 'd': 4,
  };

  const handleFileSelect = useCallback((file: File | null) => {
    setError(null);
    setTransformedOutput('');
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImageBase64(e.target?.result as string);
      };
      reader.onerror = () => {
        setError('Failed to read file.');
        setImageBase64(null);
        setFileName(null);
      };
      reader.readAsDataURL(file);
    } else {
      setImageBase64(null);
      setFileName(null);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!imageBase64) {
      setError('Please select an image first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setTransformedOutput('');

    try {
      // Remove data URL prefix if present, e.g., "data:image/png;base64,"
      const base64Data = imageBase64.split(',')[1] || imageBase64;
      const rawAnswers: ExtractedAnswer[] = await extractAnswersFromImage(base64Data);

      if (!rawAnswers || rawAnswers.length === 0) {
        setError('No answers found or could not parse answers from the image. Please ensure the image is clear and contains answers in the expected format (e.g., 1. (a)).');
        setIsLoading(false);
        return;
      }
      
      const sortedAndTransformed = rawAnswers
        .filter(item => item.question && item.answer && /^\d+$/.test(item.question) && /^[a-d]$/i.test(item.answer)) // Basic validation
        .map(item => ({
          question: parseInt(item.question, 10),
          answer: LETTER_TO_NUMBER_MAP[item.answer.toLowerCase()] || 0, // Default to 0 if not found, though validation should prevent this
        }))
        .filter(item => item.answer !== 0) // Filter out any invalid conversions
        .sort((a, b) => a.question - b.question);

      if (sortedAndTransformed.length === 0 && rawAnswers.length > 0) {
         setError('Answers were extracted, but could not be mapped to the 1-4 format. Check if answers are (a,b,c,d).');
      } else if (sortedAndTransformed.length === 0) {
         setError('Could not extract or transform any valid answers.');
      }


      const outputString = sortedAndTransformed
        .map(item => `${item.question}-${item.answer}`)
        .join(', ');
      
      setTransformedOutput(outputString);

    } catch (err) {
      console.error("Error processing image:", err);
      let message = 'An unexpected error occurred.';
      if (err instanceof Error) {
        message = err.message;
      }
      setError(`Failed to process image: ${message}. Ensure your API key is correctly configured.`);
    } finally {
      setIsLoading(false);
    }
  }, [imageBase64, LETTER_TO_NUMBER_MAP]);

  return (
    <div className="bg-slate-800 shadow-2xl rounded-xl p-6 md:p-10 space-y-8 min-w-0 max-w-2xl mx-auto">
      <header className="text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-emerald-400">
          OCR Answer Key Converter
        </h1>
        <p className="text-slate-400 mt-2 text-sm md:text-base">
          Upload an image of multiple-choice answers to get a formatted key.
        </p>
      </header>

      <main className="space-y-6">
        <ImageUploadArea onFileSelect={handleFileSelect} imagePreviewUrl={imageBase64} fileName={fileName} icon={<DocumentArrowUpIcon className="w-8 h-8 text-slate-500" />} />

        {imageBase64 && (
          <Button 
            onClick={handleSubmit} 
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-sky-500 to-emerald-600 hover:from-sky-600 hover:to-emerald-700 text-white"
          >
            {isLoading ? (
              <LoadingSpinner size="sm" /> 
            ) : (
              <div className="flex items-center justify-center">
                <SparklesIcon className="w-5 h-5 mr-2" />
                Process Answers
              </div>
            )}
          </Button>
        )}

        {error && <ErrorMessage message={error} />}
        
        {transformedOutput && !isLoading && !error && (
          <ResultsDisplay output={transformedOutput} />
        )}
      </main>
      <footer className="text-center text-xs text-slate-500 pt-4 border-t border-slate-700">
        Powered by Gemini API & React
      </footer>
    </div>
  );
};

export default App;
