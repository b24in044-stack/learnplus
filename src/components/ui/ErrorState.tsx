import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Data Retrieval Error',
  message,
  onRetry,
  className = ''
}) => {
  return (
    <div className={`p-6 border border-red-200 bg-red-50/60 rounded-xl space-y-3 max-w-lg mx-auto ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-[#B91C1C]">{title}</h4>
          <p className="text-xs text-red-900 leading-relaxed">{message}</p>
        </div>
      </div>
      {onRetry && (
        <div className="pt-1 pl-8">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            className="border-red-300 text-red-800 hover:bg-red-100"
          >
            Retry Request
          </Button>
        </div>
      )}
    </div>
  );
};
