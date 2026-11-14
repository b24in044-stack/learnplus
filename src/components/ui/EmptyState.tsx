import React from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = ''
}) => {
  return (
    <div className={`p-8 text-center max-w-md mx-auto space-y-3 ${className}`}>
      <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 text-[#4338CA] flex items-center justify-center mx-auto shadow-xs">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-[#0F172A]">{title}</h3>
      <p className="text-xs text-[#64748B] leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <div className="pt-2">
          <Button variant="primary" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
};
