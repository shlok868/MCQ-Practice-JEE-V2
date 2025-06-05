
import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', message }) => {
  const sizeClasses = {
    sm: 'w-5 h-5 border-2',
    md: 'w-8 h-8 border-4',
    lg: 'w-12 h-12 border-[6px]',
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 space-y-2">
      <div 
        className={`animate-spin rounded-full ${sizeClasses[size]} border-sky-400 border-t-transparent`}
        role="status"
        aria-live="polite"
        aria-label={message || "Loading..."}
      >
        <span className="sr-only">{message || "Loading..."}</span>
      </div>
      {message && <p className="text-slate-400 text-sm mt-2">{message}</p>}
    </div>
  );
};
