import React, { useState, useEffect } from 'react';
import {
  GitFork,
  CheckCircle,
  Clock,
  Lock,
  ArrowRight,
  Sparkles,
  Bot,
  FileText,
  Play
} from 'lucide-react';
import { AgentWorkflowResult, LearningAssignmentHistory, LearningPathNode, Course } from '../../types';
import { api } from '../../services/api';
import { NavTab } from '../layout/Sidebar';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { ErrorState } from '../ui/ErrorState';
import { LearningAgentWorkspace } from '../learning-agent/LearningAgentWorkspace';

interface PersonalizedLearningPathProps {
  courses: Course[];
  activeCourseId?: string | null;
  onNavigate: (tab: NavTab, params?: { topicQuery?: string; courseId?: string }) => void;
}

interface PersonalizedRecommendation {
  id: string;
  topic: string;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const PersonalizedLearningPath: React.FC<PersonalizedLearningPathProps> = ({
  courses,
  activeCourseId: propCourseId,
  onNavigate
}) => {
  const [selectedCourseId, setSelectedCourseId] = useState<string>(
    propCourseId || (courses.length > 0 ? courses[0].id : '')
  );
  const [nodes, setNodes] = useState<LearningPathNode[]>([]);
  const [personalizedRecommendations, setPersonalizedRecommendations] = useState<PersonalizedRecommendation[]>([]);
  const [personalizationError, setPersonalizationError] = useState<string | null>(null);
  const [assignmentLearningPlan, setAssignmentLearningPlan] = useState<
    LearningAssignmentHistory['overview']['personalizedLearningPlan']
  >([]);
  const [assignmentLearningError, setAssignmentLearningError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<LearningPathNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [showAssignmentInsights, setShowAssignmentInsights] = useState(false);

  const activeCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];

  useEffect(() => {
    if (propCourseId) {
      setSelectedCourseId(propCourseId);
    }
  }, [propCourseId]);

  useEffect(() => {
    let active = true;
    const loadPath = async () => {
      setIsLoading(true);
      setError(null);
      setPersonalizationError(null);
      setAssignmentLearningError(null);
      setAssignmentLearningPlan([]);
      setPersonalizedRecommendations([]);
      try {
        const pathData = await api.getLearningPath(selectedCourseId);
        if (!active) return;
        setNodes(pathData);
        if (selectedCourseId) {
          try {
            const history = await api.getLearningAssignmentHistory();
            if (!active) return;
            setAssignmentLearningPlan(history.overview.personalizedLearningPlan.filter(
              (item) => item.courseId === selectedCourseId
            ));
          } catch (historyError) {
            if (active) {
              setAssignmentLearningError(
                historyError instanceof Error ? historyError.message : 'Completed-assignment recommendations could not be loaded.'
              );
            }
          }
        }
        if (pathData.length > 0) {
          const inProg = pathData.find(n => n.status === 'in_progress') || pathData[0];
          setSelectedNode(inProg);
        } else {
          setSelectedNode(null);
          if (selectedCourseId) {
            try {
              const workflow: AgentWorkflowResult = await api.getPersonalizedLearning(selectedCourseId);
              if (!active) return;
              const recommendationData = workflow.data.recommendations;
              const items = isRecord(recommendationData) && Array.isArray(recommendationData.recommendations)
                ? recommendationData.recommendations
                : [];
              setPersonalizedRecommendations(items.flatMap((item, index) => {
                if (!isRecord(item) || typeof item.topic !== 'string' || typeof item.reason !== 'string') {
                  return [];
                }
                return [{
                  id: typeof item.topicId === 'string' ? item.topicId : `${item.topic}-${index}`,
                  topic: item.topic,
                  reason: item.reason,
                }];
              }));
            } catch (loadError) {
              if (active) {
                setPersonalizationError(
                  loadError instanceof Error ? loadError.message : 'Personalized recommendations could not be loaded.'
                );
              }
            }
          }
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'The learning path could not be loaded.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadPath();
    return () => {
      active = false;
    };
  }, [selectedCourseId, loadAttempt]);

  if (showAssignmentInsights) {
    return (
      <LearningAgentWorkspace
        onNavigate={onNavigate}
        onBackToPath={() => setShowAssignmentInsights(false)}
      />
    );
  }

  const assignmentLearningSection = assignmentLearningPlan.length > 0 ? (
    <Card className="p-5">
      <h2 className="text-sm font-bold text-[#0F172A]">Recommendations from completed assignments</h2>
      <p className="mt-1 text-[11px] text-[#64748B]">
        Based on published AI-practice results for {activeCourse?.code || 'this course'}; these are learning estimates, not official marks.
      </p>
      <ul className="mt-3 space-y-3">
        {assignmentLearningPlan.map((item) => (
          <li key={`${item.courseId || selectedCourseId}-${item.topic}`} className="rounded-lg bg-amber-50 p-3">
            <p className="text-xs font-bold text-[#0F172A]">{item.topic}</p>
            <p className="mt-1 text-xs text-[#475569]">{item.reason} {item.action}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => onNavigate('tutor', {
                courseId: item.courseId || selectedCourseId,
                topicQuery: `Help me review ${item.topic} in ${activeCourse?.code || 'this course'}. ${item.reason} This is AI practice evidence, not an official grade.`,
              })}
            >
              Review with AI Tutor
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  ) : null;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">
            Personalized Academic Learning Path
          </h1>
          <p className="text-xs text-[#64748B] mt-1">
            Review the saved prerequisite sequence and mastery progress for a course.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={() => setShowAssignmentInsights(true)}>
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Assignment history & insights
          </Button>
          {courses.length > 0 && (
            <div className="flex items-center gap-2">
            <span className="text-xs text-[#64748B]">Active Course:</span>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="bg-white border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-1.5 focus:border-[#4338CA] outline-none"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <LoadingSkeleton className="h-96 w-full rounded-xl lg:col-span-2" />
          <LoadingSkeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState
          title="Learning path unavailable"
          message={error}
          onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
        />
      ) : nodes.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<GitFork className="w-6 h-6" />}
            title="No Learning Path Generated"
            description={`No saved learning path is available for ${activeCourse?.code || 'this course'}.`}
            actionLabel="View Course Topics"
            onAction={() => onNavigate('courses', { courseId: selectedCourseId })}
          />
          {assignmentLearningSection}
          {assignmentLearningError && (
            <p role="status" className="mt-3 text-[11px] text-[#64748B]">
              Completed-assignment recommendations are unavailable: {assignmentLearningError}
            </p>
          )}
          {personalizedRecommendations.length > 0 && (
            <div className="mt-5 border-t border-[#E2E8F0] pt-4">
              <p className="text-xs font-semibold text-[#0F172A]">
                AI recommendations based on your graded practice:
              </p>
              <ul className="mt-2 space-y-2">
                {personalizedRecommendations.map((item) => (
                  <li key={item.id} className="text-xs text-[#64748B]">
                    <span className="font-semibold text-[#334155]">{item.topic}:</span> {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {personalizationError && (
            <p role="status" className="mt-3 text-[11px] text-[#64748B]">
              AI personalization is unavailable: {personalizationError}
            </p>
          )}
        </Card>
      ) : (
        /* Main Layout: Interactive Graph Flow + Selected Node Detail Deck */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {assignmentLearningSection && (
            <div className="lg:col-span-3">{assignmentLearningSection}</div>
          )}
          {assignmentLearningError && (
            <p role="status" className="lg:col-span-3 text-[11px] text-[#64748B]">
              Completed-assignment recommendations are unavailable: {assignmentLearningError}
            </p>
          )}
          {/* Concept Flow Steps (2 Cols) */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0F172A]">
                  Prerequisite Sequence · {activeCourse?.code}
                </h2>
                <Badge variant="indigo">
                  {nodes.filter(n => n.status === 'mastered').length} of {nodes.length} Mastered
                </Badge>
              </div>

              <div className="relative pl-6 space-y-8 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                {nodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  const isMastered = node.status === 'mastered';
                  const isInProgress = node.status === 'in_progress';
                  const isLocked = node.status === 'locked';

                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      className={`relative p-4 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#4338CA] bg-indigo-50/30 shadow-xs'
                          : 'border-[#E2E8F0] bg-white hover:border-slate-300'
                      }`}
                    >
                      {/* Node Circle Anchor on the timeline line */}
                      <div
                        className={`absolute -left-[31px] top-4 w-6 h-6 rounded-full border-2 flex items-center justify-center text-white text-[10px] font-bold ${
                          isMastered
                            ? 'bg-[#15803D] border-white'
                            : isInProgress
                            ? 'bg-[#4338CA] border-white ring-2 ring-indigo-200'
                            : 'bg-slate-300 border-white text-slate-600'
                        }`}
                      >
                        {isMastered ? (
                          <CheckCircle className="w-3.5 h-3.5" />
                        ) : isLocked ? (
                          <Lock className="w-3 h-3 text-white" />
                        ) : (
                          node.sequenceNumber
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-[#0F172A]">
                            {node.sequenceNumber}. {node.title}
                          </span>

                          <div className="flex items-center gap-2">
                            {isMastered && (
                              <Badge variant="success">
                                Mastered ({node.masteryScore}%)
                              </Badge>
                            )}
                            {isInProgress && (
                              <Badge variant="indigo" className="animate-pulse">
                                Current Focus ({node.masteryScore}%)
                              </Badge>
                            )}
                            {isLocked && (
                              <Badge variant="neutral">
                                Prerequisite Locked
                              </Badge>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-[#64748B] leading-relaxed">
                          <strong className="text-[#334155]">Pedagogical Rationale:</strong> {node.whyNextReason}
                        </p>

                        <div className="flex items-center gap-4 text-[11px] text-[#64748B] pt-1">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>~{node.estimatedMinutes} min</span>
                          </div>
                          {node.prerequisites.length > 0 && (
                            <div className="flex items-center gap-1">
                              <span>Prereqs: {node.prerequisites.length} completed</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Selected Concept Deep-Dive Deck (1 Col) */}
          {selectedNode && (
            <div className="space-y-4">
              <Card className="p-6 space-y-4 sticky top-20">
                <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
                  <Badge variant="indigo">Step {selectedNode.sequenceNumber}</Badge>
                  <span className="text-xs text-[#64748B]">
                    ~{selectedNode.estimatedMinutes} minutes
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    {selectedNode.title}
                  </h3>
                  <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                    {selectedNode.whyNextReason}
                  </p>
                </div>

                {/* Related Resources */}
                {selectedNode.relatedResources && selectedNode.relatedResources.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-[#0F172A]">
                      Associated Course Materials
                    </span>
                    <div className="space-y-1.5">
                      {selectedNode.relatedResources.map((res, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2 bg-slate-50 border border-[#E2E8F0] rounded text-xs text-[#334155]"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#4338CA] shrink-0" />
                          <span className="truncate">{res}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active Recall Practice Prompt */}
                {selectedNode.practicePrompt && (
                  <div className="space-y-1.5 p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-lg">
                    <span className="text-xs font-semibold text-[#4338CA] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Recommended Practice Drill
                    </span>
                    <p className="text-xs text-[#334155] italic leading-relaxed">
                      "{selectedNode.practicePrompt}"
                    </p>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    icon={<Bot className="w-3.5 h-3.5" />}
                    onClick={() =>
                      onNavigate('tutor', {
                        topicQuery: `I want to study ${selectedNode.title} in ${activeCourse?.code}. Can you explain this concept and guide me through: ${selectedNode.practicePrompt}`
                      })
                    }
                  >
                    Study Concept with AI Tutor
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
