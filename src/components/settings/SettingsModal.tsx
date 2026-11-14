import React, { useState } from 'react';
import {
  X,
  Server,
  Activity,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Layers,
  ExternalLink,
  Code2
} from 'lucide-react';
import { useApiStatus } from '../../context/ApiStatusContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const {
    apiUrl,
    setApiUrl,
    isLive,
    isChecking,
    latencyMs,
    lastChecked,
    checkHealth,
    statusMessage
  } = useApiStatus();

  const [inputUrl, setInputUrl] = useState(apiUrl);
  const [resetMessage, setResetMessage] = useState('');
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  if (!isOpen) return null;

  const handleSaveUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setApiUrl(inputUrl);
  };

  const handleResetData = () => {
    if (!isDemoMode) return;
    localStorage.removeItem('sa_ai_courses_data');
    localStorage.removeItem('sa_ai_documents_data');
    localStorage.removeItem('sa_ai_assessments_data');
    localStorage.removeItem('sa_ai_recommendations_data');
    localStorage.removeItem('sa_ai_analytics_data');
    localStorage.removeItem('sa_ai_learning_path_data');
    localStorage.removeItem('sa_ai_chat_sessions_data');
    localStorage.removeItem('sa_ai_chat_messages_data');
    setResetMessage('Demo data cleared. Reloading to initialize the demo again...');
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  const plannedLayers = [
    { num: 1, name: 'Input Processing', desc: 'Planned capability; no multi-modal processing service is connected.' },
    { num: 2, name: 'Student Context', desc: 'Profile and progress records are stored; no AI memory/reasoning service is connected.' },
    { num: 3, name: 'Pedagogical Planning', desc: 'No live AI planning provider is configured.' },
    { num: 4, name: 'Document Retrieval', desc: 'Document extraction, embeddings, and retrieval are not configured.' },
    { num: 5, name: 'Formative Assessment', desc: 'Faculty can generate Groq-powered drafts for review; publishing remains an explicit faculty action.' },
    { num: 6, name: 'Response Validation', desc: 'No automated AI safety/grounding validation service is connected.' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-[#E2E8F0] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-[#4338CA]" />
            <div>
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Express API & System Configuration
              </h2>
              <p className="text-xs text-[#64748B]">
                Configure the Express API endpoint and inspect available services
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#64748B] hover:text-[#0F172A] rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Connection Status Card */}
          <div className="p-4 rounded-lg border border-[#E2E8F0] bg-slate-50/70 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#334155] uppercase tracking-wider">
                Backend Status
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isLive ? 'bg-[#15803D]' : 'bg-amber-500'
                  }`}
                />
                <span
                  className={`text-xs font-semibold ${
                    isLive ? 'text-[#15803D]' : 'text-amber-700'
                  }`}
                >
                  {isLive ? `API Live (${latencyMs}ms)` : 'API unavailable'}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#475569] leading-relaxed">
              {statusMessage}
            </p>

            {lastChecked && (
              <p className="text-[11px] text-[#94A3B8]">
                Last checked: {lastChecked.toLocaleTimeString()}
              </p>
            )}

            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={checkHealth}
                disabled={isChecking}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-[#4338CA] hover:bg-[#3730A3] disabled:opacity-50 rounded-md transition-colors"
              >
                <Activity className="w-3.5 h-3.5" />
                {isChecking ? 'Probing /health...' : 'Probe API Health (/health)'}
              </button>
            </div>
          </div>

          {/* API Base URL Setting */}
          <form onSubmit={handleSaveUrl} className="space-y-3">
            <label className="block text-xs font-semibold text-[#0F172A]">
              API Base URL
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="http://localhost:8000/api/v1"
                className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-[#E2E8F0] rounded-md text-[#0F172A] focus:border-[#4338CA] outline-none"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-md transition-colors shrink-0"
              >
                Update & Ping
              </button>
            </div>
            <p className="text-[11px] text-[#64748B]">
              Standard environment default configured via <code className="text-[#4338CA] font-mono">VITE_API_BASE_URL</code> in <code className="font-mono">.env.example</code>.
            </p>
          </form>

          {/* API Contract Reference */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Code2 className="w-4 h-4 text-[#4338CA]" />
              <h3 className="text-xs font-semibold text-[#0F172A]">
                Express API Endpoints
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#15803D] font-bold">GET</span> /health
              </div>
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#15803D] font-bold">GET</span> /me
              </div>
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#15803D] font-bold">GET</span> /me/courses
              </div>
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#15803D] font-bold">GET</span> /me/progress
              </div>
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#15803D] font-bold">GET</span> /me/recommendations
              </div>
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#4338CA] font-bold">POST</span> /courses/&#123;id&#125;/documents
              </div>
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#4338CA] font-bold">POST</span> /chat/sessions/&#123;id&#125;/messages
              </div>
              <div className="p-2 rounded bg-slate-50 border border-[#E2E8F0] text-[#334155]">
                <span className="text-[#4338CA] font-bold">POST</span> /assessments/&#123;id&#125;/submit
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#4338CA]" />
              <h3 className="text-xs font-semibold text-[#0F172A]">
                Planned AI Capabilities (not active)
              </h3>
            </div>
            <div className="space-y-2">
              {plannedLayers.map((layer) => (
                <div
                  key={layer.num}
                  className="p-2.5 rounded-lg border border-[#E2E8F0] bg-white flex items-start gap-3"
                >
                  <span className="w-5 h-5 rounded bg-indigo-100 text-[#4338CA] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {layer.num}
                  </span>
                  <div>
                    <h4 className="text-xs font-semibold text-[#0F172A]">{layer.name}</h4>
                    <p className="text-[11px] text-[#64748B] mt-0.5 leading-relaxed">{layer.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Database Reset Section */}
          {isDemoMode && <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-[#0F172A]">Reset Demo Seed Data</h4>
              <p className="text-[11px] text-[#64748B]">
                Clears browser-local demo data. It does not affect server or Supabase records.
              </p>
              {resetMessage && (
                <p className="text-[11px] text-[#15803D] font-medium mt-1">{resetMessage}</p>
              )}
            </div>
            <button
              onClick={handleResetData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset State
            </button>
          </div>}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#E2E8F0] bg-slate-50 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-white bg-[#4338CA] hover:bg-[#3730A3] rounded-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
