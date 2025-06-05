
import React, { useRef, useCallback } from 'react';

interface ImageUploadAreaProps {
  onFileSelect: (file: File | null) => void;
  imagePreviewUrl: string | null;
  fileName: string | null;
  icon?: React.ReactNode;
}

export const ImageUploadArea: React.FC<ImageUploadAreaProps> = ({ onFileSelect, imagePreviewUrl, fileName, icon }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    onFileSelect(file);
  };

  const handleAreaClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // Add some visual indication for drag over
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0] || null;
    onFileSelect(file);
    if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Clear the input value if needed for re-selection
    }
  }, [onFileSelect]);


  return (
    <div className="space-y-4">
      <div
        className="w-full p-6 border-2 border-dashed border-slate-600 hover:border-sky-500 rounded-lg text-center cursor-pointer transition-colors duration-200 ease-in-out bg-slate-700/50 hover:bg-slate-700"
        onClick={handleAreaClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/png, image/jpeg, image/webp"
          className="hidden"
        />
        {imagePreviewUrl ? (
          <div className="flex flex-col items-center">
             <img src={imagePreviewUrl} alt="Preview" className="max-h-48 w-auto object-contain rounded-md mb-3 shadow-md" />
             <p className="text-sm text-slate-300 truncate max-w-full">{fileName || 'Image selected'}</p>
             <p className="text-xs text-sky-400 mt-1">Click here or drag new image to change</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-2 text-slate-400">
            {icon || <DefaultUploadIcon />}
            <p className="text-lg font-medium">Click to upload or drag & drop</p>
            <p className="text-xs">PNG, JPG, WEBP (MAX. 5MB)</p>
          </div>
        )}
      </div>
    </div>
  );
};

const DefaultUploadIcon: React.FC = () => (
    <svg className="w-12 h-12 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338 0 4.5 4.5 0 0 1-1.41 8.775H6.75Z" />
    </svg>
);
