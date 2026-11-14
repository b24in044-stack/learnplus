import React, { useState, useEffect } from 'react';
import {
  Code2,
  Play,
  RotateCcw,
  Sparkles,
  CheckCircle,
  XCircle,
  Clock,
  HelpCircle,
  Bot,
  Terminal,
  FileCode,
  Layers,
  ChevronRight,
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { CodingProblem } from '../../types';
import { api } from '../../services/api';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { NavTab } from '../layout/Sidebar';

interface CodingLabProps {
  onNavigate: (tab: NavTab, params?: { courseId?: string; topicQuery?: string }) => void;
}

export const CodingLab: React.FC<CodingLabProps> = ({ onNavigate }) => {
  const [problems, setProblems] = useState<CodingProblem[]>([]);
  const [selectedProblemId, setSelectedProblemId] = useState<string>('prob_avl_rot');
  const [language, setLanguage] = useState<'python' | 'javascript'>('python');
  const [userCode, setUserCode] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isLoadingProblems, setIsLoadingProblems] = useState<boolean>(true);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [executionResult, setExecutionResult] = useState<{
    success: boolean;
    passedCount: number;
    totalCount: number;
    results: { id: string; passed: boolean; output: string; expected: string; executionTimeMs: number }[];
    consoleOutput: string;
    complexityAnalysis?: { time: string; space: string; explanation: string };
    isDemo?: boolean;
  } | null>(null);

  const [revealedHints, setRevealedHints] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<'tests' | 'console'>('tests');

  useEffect(() => {
    let active = true;
    setIsLoadingProblems(true);
    setProblemError(null);
    api.getCodingProblems().then((list) => {
      if (!active) return;
      setProblems(list);
      if (list.length > 0) {
        setSelectedProblemId(list[0].id);
        setUserCode(list[0].starterCode[language] || '');
      }
    }).catch((error: unknown) => {
      if (active) {
        setProblemError(error instanceof Error ? error.message : 'Unable to load coding problems.');
      }
    }).finally(() => {
      if (active) setIsLoadingProblems(false);
    });

    return () => {
      active = false;
    };
  }, [reloadAttempt]);

  const currentProblem = problems.find(p => p.id === selectedProblemId) || problems[0];

  useEffect(() => {
    if (currentProblem) {
      setUserCode(currentProblem.starterCode[language] || '');
      setExecutionResult(null);
      setRevealedHints([]);
    }
  }, [selectedProblemId, language]);

  const handleResetCode = () => {
    if (currentProblem) {
      setUserCode(currentProblem.starterCode[language] || '');
      setExecutionResult(null);
    }
  };

  const handleRunTests = async () => {
    if (!currentProblem) return;
    setIsRunning(true);
    setExecutionError(null);
    try {
      const res = await api.runCodingSolution(currentProblem.id, userCode, language);
      setExecutionResult(res);
      setActiveTab('tests');
    } catch (error: unknown) {
      setExecutionError(error instanceof Error ? error.message : 'The coding service is unavailable.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleRevealHint = (hintIdx: number) => {
    if (!revealedHints.includes(hintIdx)) {
      setRevealedHints([...revealedHints, hintIdx]);
    }
  };

  if (!currentProblem) {
    if (isLoadingProblems) {
      return <div className="p-8 text-center text-xs text-[#64748B]">Loading Coding Lab...</div>;
    }
    return (
      <div className="p-8 text-center text-xs text-[#64748B]" role={problemError ? 'alert' : undefined}>
        {problemError ? (
          <>
            <p>{problemError}</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => setReloadAttempt((attempt) => attempt + 1)}>
              Retry
            </Button>
          </>
        ) : 'No coding problems are currently available.'}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-[#E2E8F0]">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="indigo">{isDemoMode ? 'Demo Evaluation' : 'Practice Lab'}</Badge>
            <span className="text-xs text-[#64748B]">
              Secure code execution is unavailable; submitted code is not executed.
            </span>
          </div>
          <h1 className="text-xl font-bold text-[#0F172A] mt-1 tracking-tight">
            Coding Practice Lab
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedProblemId}
            onChange={(e) => setSelectedProblemId(e.target.value)}
            className="text-xs font-semibold bg-white border border-[#E2E8F0] rounded-lg px-3 py-2 text-[#0F172A] outline-none focus:border-[#4338CA]"
          >
            {problems.map(p => (
              <option key={p.id} value={p.id}>
                {p.courseCode} · {p.title} ({p.difficulty})
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onNavigate('tutor', {
                courseId: 'course_cs201',
                topicQuery: `I'm working on "${currentProblem.title}". Can you give me Socratic guidance on my code?\n\n\`\`\`${language}\n${userCode}\n\`\`\``
              })
            }
            icon={<Bot className="w-3.5 h-3.5 text-[#4338CA]" />}
          >
            Ask AI Tutor
          </Button>
        </div>
      </div>

      {/* Main Two-Column Split Screen */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Problem Details & Socratic Hints (5 cols) */}
        <div className="lg:col-span-5 space-y-4 overflow-y-auto max-h-[calc(100vh-180px)] pr-1">
          <Card className="p-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    currentProblem.difficulty === 'Easy'
                      ? 'teal'
                      : currentProblem.difficulty === 'Medium'
                      ? 'amber'
                      : 'red'
                  }
                >
                  {currentProblem.difficulty}
                </Badge>
                <span className="text-xs font-semibold text-[#4338CA]">
                  {currentProblem.courseCode}
                </span>
                <span className="text-xs text-[#64748B]">·</span>
                <span className="text-xs text-[#64748B]">{currentProblem.topicTag}</span>
              </div>

              <h2 className="text-base font-bold text-[#0F172A] tracking-tight">
                {currentProblem.title}
              </h2>
            </div>

            <div className="text-xs text-[#334155] leading-relaxed whitespace-pre-line border-t border-[#F1F5F9] pt-3">
              {currentProblem.description}
            </div>

            {/* Examples */}
            {currentProblem.examples.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider block">
                  Example Cases
                </span>
                {currentProblem.examples.map((ex, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1 font-mono"
                  >
                    <div>
                      <strong className="text-[#64748B]">Input: </strong>
                      <span className="text-[#0F172A]">{ex.input}</span>
                    </div>
                    <div>
                      <strong className="text-[#64748B]">Output: </strong>
                      <span className="text-[#15803D] font-bold">{ex.output}</span>
                    </div>
                    {ex.explanation && (
                      <div className="font-sans text-[11px] text-[#64748B] pt-1">
                        <strong>Explanation: </strong>{ex.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Constraints */}
            <div className="space-y-1.5 pt-2 border-t border-[#F1F5F9]">
              <span className="text-xs font-semibold text-[#0F172A] uppercase tracking-wider block">
                Target Constraints & Complexity
              </span>
              <ul className="list-disc list-inside space-y-1 text-xs text-[#64748B]">
                {currentProblem.constraints.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>

            {/* Socratic AI Hints */}
            <div className="space-y-2 pt-2 border-t border-[#F1F5F9]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#4338CA]" />
                  <span>Socratic Guidance Hints</span>
                </span>
                <span className="text-[11px] text-[#64748B]">
                  {revealedHints.length} / {currentProblem.hints.length} revealed
                </span>
              </div>

              <div className="space-y-2">
                {currentProblem.hints.map((hint, idx) => {
                  const isRevealed = revealedHints.includes(idx);
                  return (
                    <div
                      key={idx}
                      className="border border-[#E2E8F0] rounded-lg p-2.5 bg-slate-50 text-xs transition-colors"
                    >
                      {isRevealed ? (
                        <div className="space-y-1">
                          <span className="font-semibold text-[#4338CA] text-[11px]">
                            Hint {idx + 1}:
                          </span>
                          <p className="text-[#0F172A] leading-relaxed">{hint}</p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRevealHint(idx)}
                          className="w-full text-left text-[#64748B] hover:text-[#4338CA] flex items-center justify-between font-medium cursor-pointer"
                        >
                          <span>Reveal Hint {idx + 1}</span>
                          <HelpCircle className="w-3.5 h-3.5 text-[#94A3B8]" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Code Editor & Execution Results (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-3">
          {/* Editor Header Bar */}
          <div className="bg-[#0F172A] text-white px-4 py-2.5 rounded-t-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <FileCode className="w-4 h-4 text-indigo-400" />
                <span>Editor</span>
              </div>

              <div className="bg-slate-800 p-0.5 rounded-md flex items-center text-xs">
                <button
                  onClick={() => setLanguage('python')}
                  className={`px-2.5 py-1 rounded cursor-pointer font-mono ${
                    language === 'python' ? 'bg-[#4338CA] text-white font-semibold' : 'text-slate-400'
                  }`}
                >
                  Python 3
                </button>
                <button
                  onClick={() => setLanguage('javascript')}
                  className={`px-2.5 py-1 rounded cursor-pointer font-mono ${
                    language === 'javascript' ? 'bg-[#4338CA] text-white font-semibold' : 'text-slate-400'
                  }`}
                >
                  JavaScript
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleResetCode}
                title="Reset code"
                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <Button
                variant="primary"
                size="sm"
                onClick={handleRunTests}
                isLoading={isRunning}
                className="bg-[#4338CA] hover:bg-[#3730A3]"
                icon={<Play className="w-3 h-3 fill-current" />}
              >
                Run Tests
              </Button>
            </div>
            {executionError && <p className="mt-2 text-xs text-red-700" role="alert">{executionError}</p>}
          </div>

          {/* Code Textarea with line numbers */}
          <div className="relative bg-[#0F172A] border-x border-[#0F172A] min-h-[300px] flex text-xs font-mono">
            <textarea
              value={userCode}
              onChange={(e) => setUserCode(e.target.value)}
              spellCheck={false}
              className="w-full h-80 p-4 bg-transparent text-slate-100 font-mono text-xs leading-relaxed outline-none resize-y selection:bg-indigo-700"
            />
          </div>

          {/* Test Cases & Console Output Panel */}
          <Card className="rounded-t-none border-t-0 p-0 overflow-hidden shadow-xs">
            <div className="border-b border-[#E2E8F0] bg-slate-50 px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs font-semibold">
                <button
                  onClick={() => setActiveTab('tests')}
                  className={`pb-1 cursor-pointer transition-colors ${
                    activeTab === 'tests'
                      ? 'border-b-2 border-[#4338CA] text-[#4338CA]'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  Test Cases {executionResult && `(${executionResult.passedCount}/${executionResult.totalCount})`}
                </button>
                <button
                  onClick={() => setActiveTab('console')}
                  className={`pb-1 cursor-pointer transition-colors ${
                    activeTab === 'console'
                      ? 'border-b-2 border-[#4338CA] text-[#4338CA]'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  Console Output
                </button>
              </div>

              {executionResult && (
                <div className="flex items-center gap-2">
                  <Badge variant={executionResult.success ? 'green' : 'amber'}>
                    {executionResult.isDemo
                      ? 'Demo Estimate Only'
                      : executionResult.success ? 'All Tests Passed' : 'Test Failures Detected'}
                  </Badge>
                </div>
              )}
            </div>

            <div className="p-4 min-h-[160px] max-h-[240px] overflow-y-auto">
              {activeTab === 'tests' ? (
                executionResult ? (
                  <div className="space-y-3">
                    {executionResult.isDemo && (
                      <p className="text-xs text-amber-800" role="status">
                        Source code was not executed. These results are a demo-only heuristic.
                      </p>
                    )}
                    {/* Complexity analysis banner if present */}
                    {executionResult.complexityAnalysis && (
                      <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between text-xs text-[#3730A3]">
                        <div className="flex items-center gap-2 font-mono">
                          <Cpu className="w-4 h-4 text-[#4338CA]" />
                          <span>Time: {executionResult.complexityAnalysis.time}</span>
                          <span className="text-[#94A3B8]">|</span>
                          <span>Space: {executionResult.complexityAnalysis.space}</span>
                        </div>
                        <span className="text-[11px] text-indigo-700 font-sans">
                          {executionResult.complexityAnalysis.explanation}
                        </span>
                      </div>
                    )}

                    <div className="space-y-2">
                      {executionResult.results.map((res, idx) => (
                        <div
                          key={res.id}
                          className={`p-3 rounded-lg border text-xs font-mono space-y-1 ${
                            res.passed
                              ? 'bg-green-50/60 border-green-200'
                              : 'bg-red-50/60 border-red-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {res.passed ? (
                                <CheckCircle className="w-4 h-4 text-[#15803D]" />
                              ) : (
                                <XCircle className="w-4 h-4 text-[#B91C1C]" />
                              )}
                              <span className="font-bold text-[#0F172A]">
                                Test Case #{idx + 1}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#64748B] tabular-nums">
                              {res.executionTimeMs} ms
                            </span>
                          </div>

                          <div className="text-[11px] text-[#64748B] pt-1">
                            <div><strong>Expected:</strong> {res.expected}</div>
                            <div>
                              <strong>Result:</strong>{' '}
                              <span className={res.passed ? 'text-[#15803D]' : 'text-[#B91C1C]'}>
                                {res.output}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-xs text-[#64748B]">
                    Click <strong className="text-[#0F172A]">"Run Tests"</strong> above to execute your solution against test cases in the sandbox.
                  </div>
                )
              ) : (
                /* Console Tab */
                <pre className="text-xs font-mono text-[#0F172A] whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-[#E2E8F0]">
                  {executionResult?.consoleOutput || 'Standard output will appear here after execution.'}
                </pre>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
