import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Plus,
  BookOpen,
  FileText,
  Copy,
  Check,
  RotateCw,
  Layers,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { Course, ChatSession, ChatMessage, SourceCitation, AgentLayerStep } from '../../types';
import { api } from '../../services/api';
import { useApiStatus } from '../../context/ApiStatusContext';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';

interface AITutorWorkspaceProps {
  initialQuery?: string;
  courses: Course[];
  activeCourseId?: string | null;
}

export const AITutorWorkspace: React.FC<AITutorWorkspaceProps> = ({
  initialQuery = '',
  courses,
  activeCourseId: propCourseId
}) => {
  const { isLive, healthData } = useApiStatus();
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const isDemoSimulation = healthData?.demo_mode === true || (!isLive && demoMode);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState(initialQuery);
  const [selectedCourseId, setSelectedCourseId] = useState<string>(
    propCourseId || (courses.length > 0 ? courses[0].id : '')
  );
  const [isLoading, setIsLoading] = useState(false);
  const [aiServiceStatus, setAiServiceStatus] = useState<'checking' | 'configured' | 'unavailable'>('checking');
  const [ragAvailable, setRagAvailable] = useState(false);
  const [useDocuments, setUseDocuments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<SourceCitation | null>(null);
  const [showAgentTrace, setShowAgentTrace] = useState<boolean>(true);
  const [selectedSteps, setSelectedSteps] = useState<AgentLayerStep[] | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api.getAgentStatus()
      .then((status) => {
        if (!active) return;
        const tutor = status.agents.find((agent) => agent.agent_id === 'tutor');
        setAiServiceStatus(tutor?.status === 'available' ? 'configured' : 'unavailable');
        setRagAvailable(status.rag_available);
      })
      .catch(() => {
        if (active) {
          setAiServiceStatus('unavailable');
          setRagAvailable(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Load chat sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const list = await api.getChatSessions();
        setSessions(list);
        if (list.length > 0) {
          // If no active session, pick the first one
          setActiveSessionId((prev) => (prev ? prev : list[0].id));
        } else if (courses.length > 0) {
          // Create a new session if none exist
          const newSession = await api.createChatSession(
            `Session · ${courses[0].code}`,
            courses[0].id,
            courses[0].code
          );
          setSessions([newSession]);
          setActiveSessionId(newSession.id);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Error loading chat sessions');
      }
    };
    loadSessions();
  }, [courses]);

  // Keep selectedCourseId in sync with prop
  useEffect(() => {
    if (propCourseId) {
      setSelectedCourseId(propCourseId);
    } else if (!selectedCourseId && courses.length > 0) {
      setSelectedCourseId(courses[0].id);
    }
  }, [propCourseId, courses]);

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    const loadMessages = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const msgs = await api.getChatMessages(activeSessionId);
        setMessages(msgs);
        if (msgs.length > 0) {
          const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant' && m.agentSteps);
          if (lastAssistant?.agentSteps) {
            setSelectedSteps(lastAssistant.agentSteps);
          }
          setSelectedCitation(lastAssistant?.citations?.[0] ?? null);
        } else {
          setSelectedSteps(null);
          setSelectedCitation(null);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load conversation history');
      } finally {
        setIsLoading(false);
      }
    };
    loadMessages();
  }, [activeSessionId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Handle initial query if passed
  useEffect(() => {
    if (initialQuery && initialQuery !== inputText) {
      setInputText(initialQuery);
    }
  }, [initialQuery]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const userText = inputText.trim();
    setInputText('');
    setError(null);
    setIsLoading(true);
    let temporaryMessageId: string | undefined;

    try {
      let targetSessionId = activeSessionId;
      if (!targetSessionId) {
        const activeCourse = courses.find(c => c.id === selectedCourseId) || courses[0];
        const newSession = await api.createChatSession(
          `Academic Chat · ${activeCourse?.code || 'CS'}`,
          selectedCourseId,
          activeCourse?.code
        );
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
        targetSessionId = newSession.id;
      }

      const tempUserMsg: ChatMessage = {
        id: `temp_${Date.now()}`,
        sessionId: targetSessionId,
        role: 'user',
        content: userText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      temporaryMessageId = tempUserMsg.id;
      setMessages(prev => [...prev, tempUserMsg]);

      const assistantMsg = await api.sendMessage(targetSessionId, userText, selectedCourseId, useDocuments);
      setMessages(prev => [...prev.filter(m => m.id !== temporaryMessageId), tempUserMsg, assistantMsg]);
      if (assistantMsg.agentSteps) {
        setSelectedSteps(assistantMsg.agentSteps);
      }
      if (assistantMsg.citations && assistantMsg.citations.length > 0) {
        setSelectedCitation(assistantMsg.citations[0]);
      } else {
        setSelectedCitation(null);
      }
    } catch (err) {
      if (temporaryMessageId) {
        setMessages((previous) => previous.filter((message) => message.id !== temporaryMessageId));
      }
      setInputText(userText);
      setError(err instanceof Error ? err.message : 'The AI tutor provider is unavailable. Your message was not processed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewSession = async () => {
    const course = courses.find(c => c.id === selectedCourseId) || courses[0];
    const newSession = await api.createChatSession(
      `Discussion · ${course?.code || 'Curriculum'}`,
      course?.id,
      course?.code
    );
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setMessages([]);
    setSelectedSteps(null);
    setSelectedCitation(null);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[#F8FAFC]">
      {/* 1. Left Conversation History Drawer */}
      <aside className="w-64 bg-white border-r border-[#E2E8F0] flex flex-col shrink-0 hidden md:flex">
        <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider">
            Conversations
          </span>
          <button
            onClick={handleCreateNewSession}
            className="p-1 text-[#4338CA] hover:bg-indigo-50 rounded transition-colors"
            title="Start new conversation"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={`w-full text-left p-2.5 rounded-lg text-xs transition-colors ${
                activeSessionId === s.id
                  ? 'bg-indigo-50 text-[#4338CA] font-semibold border border-indigo-100'
                  : 'text-[#475569] hover:bg-slate-50 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1">{s.title}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#94A3B8]">
                <span>{s.courseCode || 'General'}</span>
                <span>{s.updatedAt}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[#E2E8F0] bg-slate-50/50">
          <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
            <Sparkles className="w-3.5 h-3.5 text-[#4338CA]" />
            <span>
              {isDemoSimulation
                ? 'Demo mode · AI responses unavailable'
                : aiServiceStatus === 'configured'
                  ? `AI service configured · document retrieval ${ragAvailable ? 'available' : 'unavailable'}`
                  : aiServiceStatus === 'checking'
                    ? 'Checking AI service…'
                    : 'AI service unavailable'}
            </span>
          </div>
        </div>
      </aside>

      {/* 2. Main Chat Workspace */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Workspace Sub-Header */}
        <div className="h-14 px-4 sm:px-6 border-b border-[#E2E8F0] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#4338CA] shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-semibold text-[#0F172A] truncate">Academic AI Tutor</h2>
              <p className="text-[11px] text-[#64748B] truncate">
                Tutor workspace · {isDemoSimulation ? 'Demo mode · AI unavailable' : aiServiceStatus === 'configured' ? 'Configured AI service' : 'AI provider unavailable'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Course Context Dropdown */}
            {courses.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-[#64748B]">
                <span className="hidden lg:inline">Course Context:</span>
                <select
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  className="bg-slate-50 border border-[#E2E8F0] text-xs font-medium text-[#0F172A] rounded-md px-2.5 py-1 focus:border-[#4338CA] outline-none max-w-[140px] sm:max-w-none truncate"
                >
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.code}: {c.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <Button
              variant={showAgentTrace ? 'secondary' : 'outline'}
              size="sm"
              icon={<Layers className="w-3.5 h-3.5" />}
              onClick={() => setShowAgentTrace(!showAgentTrace)}
            >
              <span className="hidden sm:inline">{isDemoSimulation ? 'Demo Trace' : 'Agent Trace'}</span>
            </Button>
          </div>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="max-w-xl mx-auto py-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-[#4338CA] flex items-center justify-center mx-auto border border-indigo-100">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[#0F172A]">
                Academic Tutor Workspace
              </h3>
              <p className="text-xs text-[#64748B] leading-relaxed">
                {aiServiceStatus === 'configured' && !isDemoSimulation
                  ? 'Ask for an academic explanation, step-by-step assistance, an example, or a summary. Enable document grounding to limit answers to processed materials and receive verified citations.'
                  : 'AI tutor responses require the separate configured AI service and an authenticated Supabase account. Demo mode does not generate tutor answers.'}
              </p>

            </div>
          ) : (
            messages.map((msg) => {
              const isAssistant = msg.role === 'assistant';
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 max-w-3xl ${isAssistant ? '' : 'ml-auto justify-end'}`}
                >
                  {isAssistant && (
                    <div className="w-7 h-7 rounded-lg bg-[#4338CA] text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                      <Bot className="w-4 h-4 text-indigo-100" />
                    </div>
                  )}

                  <div className={`space-y-2 max-w-[85%] ${isAssistant ? 'w-full' : ''}`}>
                    <div
                      className={`p-4 rounded-xl text-xs leading-relaxed ${
                        isAssistant
                          ? 'bg-white border border-[#E2E8F0] text-[#0F172A] shadow-xs'
                          : 'bg-[#4338CA] text-white font-medium'
                      }`}
                    >
                      {/* Formatted Markdown-like rendering */}
                      <div className="whitespace-pre-wrap font-sans space-y-2 leading-relaxed">
                        {msg.content}
                      </div>

                      {/* Assistant Actions Bar */}
                      {isAssistant && (
                        <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
                          <div className="flex items-center gap-2">
                            <span>{msg.timestamp}</span>
                            {msg.citations && msg.citations.length > 0 ? (
                              <button
                                onClick={() => setSelectedCitation(msg.citations![0])}
                                className="inline-flex items-center gap-1 text-[#4338CA] hover:underline font-semibold"
                              >
                                <FileText className="w-3 h-3" />
                                {msg.citations.length} Grounded Citation(s)
                              </button>
                            ) : (
                              <span className="text-[10px] text-[#94A3B8] italic">
                                {msg.isDemo ? 'Demo output · no document retrieval' : 'No citations provided'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => copyToClipboard(msg.content, msg.id)}
                              className="inline-flex items-center gap-1 hover:text-[#0F172A] transition-colors"
                              title="Copy response"
                            >
                              {copiedId === msg.id ? (
                                <>
                                  <Check className="w-3 h-3 text-[#15803D]" />
                                  <span className="text-[#15803D]">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>

                            {msg.agentSteps && (
                              <button
                                onClick={() => {
                                  setSelectedSteps(msg.agentSteps || null);
                                  setShowAgentTrace(true);
                                }}
                                className="inline-flex items-center gap-1 text-[#4338CA] font-medium hover:underline"
                              >
                                <Layers className="w-3 h-3" />
                                {msg.isDemo ? 'Demo Trace' : 'Agent Trace'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {isLoading && (
            <div className="flex gap-3 max-w-xl">
              <div className="w-7 h-7 rounded-lg bg-[#4338CA] text-white flex items-center justify-center shrink-0 shadow-xs animate-pulse">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-4 bg-white border border-[#E2E8F0] rounded-xl text-xs space-y-2 shadow-xs w-full">
                <div className="flex items-center gap-2 text-[#4338CA] font-medium">
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Preparing response...</span>
                </div>
                <div className="h-2 bg-slate-100 rounded animate-pulse w-3/4" />
                <div className="h-2 bg-slate-100 rounded animate-pulse w-1/2" />
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-[#B91C1C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSendMessage()}
                className="border-red-300 text-red-900"
              >
                Retry
              </Button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Message Input Composer */}
        <div className="p-4 border-t border-[#E2E8F0] bg-white">
          <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto space-y-2">
            <div className="relative flex items-end bg-slate-50 border border-[#E2E8F0] rounded-xl focus-within:border-[#4338CA] focus-within:bg-white transition-colors p-2">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask an academic question, request a proof, or generate a practice drill..."
                rows={2}
                className="w-full text-xs text-[#0F172A] placeholder-[#94A3B8] outline-none resize-none bg-transparent px-2 py-1 max-h-32"
              />

              <button
                type="submit"
                disabled={!inputText.trim() || isLoading}
                className="px-3 py-2 bg-[#4338CA] hover:bg-[#3730A3] disabled:opacity-40 text-white rounded-lg transition-colors flex items-center justify-center shrink-0 ml-2 shadow-xs cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#64748B] px-1">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={useDocuments}
                  disabled={!ragAvailable || isLoading}
                  onChange={(event) => setUseDocuments(event.target.checked)}
                  className="accent-[#4338CA]"
                />
                Ground answer in my processed documents
                {!ragAvailable && <span className="text-[#94A3B8]">(unavailable)</span>}
              </label>
              <span>{isDemoSimulation ? 'AI tutor unavailable in demo mode' : 'AI responses require the configured AI service'}</span>
            </div>
          </form>
        </div>
      </div>


      {showAgentTrace && (
        <aside className="w-80 bg-white border-l border-[#E2E8F0] flex flex-col shrink-0 overflow-y-auto">
          {/* Header */}
          <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#4338CA]" />
              <h3 className="text-xs font-semibold text-[#0F172A]">
                {isDemoSimulation ? 'Tutor Availability' : 'Response Details'}
              </h3>
            </div>
            <button
              onClick={() => setShowAgentTrace(false)}
              className="text-[#94A3B8] hover:text-[#0F172A] text-xs"
            >
              Close
            </button>
          </div>

          <div className="p-4 space-y-6">
            {/* Step-by-step layer breakdown */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                  {isDemoSimulation ? 'Availability' : 'Execution Pipeline'}
                </span>
                <Badge variant={isLive && !isDemoSimulation ? 'success' : 'neutral'}>
                  {isDemoSimulation ? 'Demo Simulation' : isLive ? 'Live Backend' : 'Unavailable'}
                </Badge>
              </div>

              {selectedSteps ? (
                selectedSteps.map((step) => (
                  <div
                    key={step.layerNumber}
                    className="p-3 bg-slate-50 border border-[#E2E8F0] rounded-lg space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-indigo-100 text-[#4338CA] text-[10px] font-bold flex items-center justify-center">
                          {step.layerNumber}
                        </span>
                        <span className="text-xs font-semibold text-[#0F172A]">
                          {step.layerName}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[#94A3B8] tabular-nums">
                        {step.durationMs}ms
                      </span>
                    </div>
                    <p className="text-[11px] text-[#64748B] leading-relaxed pl-5">
                      {step.description}
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-xs text-[#94A3B8] border border-dashed border-[#E2E8F0] rounded-lg">
                  {isDemoSimulation
                    ? 'No AI provider is configured; tutor responses and execution traces are unavailable.'
                    : 'No execution trace is available for this response.'}
                </div>
              )}
            </div>

            {/* Source Citations Panel */}
            <div className="space-y-3 pt-3 border-t border-[#E2E8F0]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Document Retrieval
                </span>
                <span className="text-[10px] text-[#64748B] font-medium">{ragAvailable ? 'Available' : 'Unavailable'}</span>
              </div>

              {selectedCitation ? (
                <div className="p-3.5 bg-slate-50 border border-[#E2E8F0] rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#0F172A]">
                    <FileText className="w-3.5 h-3.5 text-[#4338CA] shrink-0" />
                    <span className="truncate">{selectedCitation.documentTitle}</span>
                  </div>

                  {(selectedCitation.pageNumber || selectedCitation.chunkIndex !== undefined) && (
                    <div className="text-[11px] text-[#64748B]">
                      {selectedCitation.pageNumber ? `Page ${selectedCitation.pageNumber}` : 'Course Text'}
                      {selectedCitation.chunkIndex !== undefined ? ` · Chunk ${selectedCitation.chunkIndex + 1}` : ''}
                    </div>
                  )}

                  <blockquote className="p-2.5 bg-white border-l-2 border-[#4338CA] text-[11px] text-[#334155] italic rounded-r leading-relaxed">
                    "{selectedCitation.excerpt}"
                  </blockquote>

                  <div className="flex items-center justify-between text-[10px] text-[#94A3B8] pt-1">
                    <span>Relevance Match: {(selectedCitation.confidenceScore * 100).toFixed(0)}%</span>
                    <span>Vector Similarity</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#94A3B8] italic">
                  Select a message citation to view extracted lecture text.
                </p>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
};
