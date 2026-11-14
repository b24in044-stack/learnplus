import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-semibold rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-xs px-3.5 py-2 gap-2',
    lg: 'text-sm px-4.5 py-2.5 gap-2.5'
  }[size];

  const variantStyles = {
    primary: 'bg-[#4338CA] hover:bg-[#3730A3] text-white focus-visible:outline-[#4338CA] shadow-xs',
    secondary: 'bg-indigo-50 hover:bg-indigo-100 text-[#4338CA] focus-visible:outline-[#4338CA]',
    outline: 'bg-white hover:bg-slate-50 text-[#334155] border border-[#E2E8F0] focus-visible:outline-[#4338CA] shadow-xs',
    ghost: 'hover:bg-slate-100 text-[#475569] hover:text-[#0F172A]',
    danger: 'bg-[#B91C1C] hover:bg-red-800 text-white focus-visible:outline-[#B91C1C] shadow-xs'
  }[variant];

  return (
    <button
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
};
