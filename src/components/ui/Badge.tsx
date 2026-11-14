import React from 'react';

export type BadgeVariant =
  | 'indigo'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'teal'
  | 'green'
  | 'amber'
  | 'red';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  className = ''
}) => {
  const variantStyles = {
    indigo: 'bg-indigo-50 text-[#4338CA] border-indigo-100',
    success: 'bg-green-50 text-[#15803D] border-green-200',
    green: 'bg-green-50 text-[#15803D] border-green-200',
    warning: 'bg-amber-50 text-[#B45309] border-amber-200',
    amber: 'bg-amber-50 text-[#B45309] border-amber-200',
    error: 'bg-red-50 text-[#B91C1C] border-red-200',
    red: 'bg-red-50 text-[#B91C1C] border-red-200',
    teal: 'bg-teal-50 text-[#0D9488] border-teal-200',
    neutral: 'bg-slate-100 text-[#475569] border-slate-200'
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${variantStyles} ${className}`}
    >
      {children}
    </span>
  );
};
