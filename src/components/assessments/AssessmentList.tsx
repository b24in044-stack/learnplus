import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Search,
  Play,
  RotateCcw,
  Clock,
  Award,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { Assessment, Course } from '../../types';
import { api } from '../../services/api';
import { NavTab } from '../layout/Sidebar';
import { AssignmentGenerationWorkspace } from './AssignmentGenerationWorkspace';

interface AssessmentListProps {
  courses: Course[];
  onStartQuiz: (assessment: Assessment) => void;
  onNavigate: (tab: NavTab, params?: { topicQuery?: string; courseId?: string }) => void;
}

export const AssessmentList: React.FC<AssessmentListProps> = ({ courses, onStartQuiz, onNavigate }) => {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCourse, setFilterCourse] = useState('all');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showAssignmentGenerator, setShowAssignmentGenerator] = useState(false);

  const loadAssessments = async () => {
    const list = await api.getAssessments();
    setAssessments(list);
  };

  useEffect(() => {
    loadAssessments();
  }, []);

  const filtered = assessments.filter((a) => {
    const matchesSearch =
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.courseCode.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filterCourse !== 'all' && a.courseId !== filterCourse) return false;
    return true;
  });

  if (showAssignmentGenerator) {
    return (
      <AssignmentGenerationWorkspace
        courses={courses}
        onNavigate={onNavigate}
        onBack={() => setShowAssignmentGenerator(false)}
      />
    );
  }

  const generatePractice = async () => {
    const course = courses.find((item) => item.id === filterCourse) || courses[0];
    if (!course) return;
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const generated = await api.generatePracticeAssessment({
        courseId: course.id,
        courseCode: course.code,
        topic: course.topics?.[0]?.title || course.title,
        difficulty: 'Intermediate',
        learningObjectives: course.description ? [course.description] : [],
        questionCount: 5,
      });
      const assessment: Assessment = {
        id: generated.assessmentId,
        courseId: generated.courseId,
        courseCode: generated.courseCode || course.code,
        title: generated.title,
        topic: generated.topic,
        difficulty: generated.difficulty,
        questionCount: generated.questions.length,
        durationMinutes: generated.durationMinutes,
        passingScore: generated.passingScore,
        attemptsCount: 0,
        aiGenerated: true,
        official: false,
        questions: generated.questions.map((question) => ({
          id: question.id,
          questionText: question.question,
          options: question.options,
          explanation: '',
          topicTag: question.topic,
        })),
      };
      setAssessments((current) => [assessment, ...current]);
      onStartQuiz(assessment);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'AI practice assessment generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">
            Assessments & Diagnostic Quizzes
          </h1>
          <p className="text-xs text-[#64748B] mt-1">
            Review available assessments and your recorded quiz results.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search quizzes and topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-[#E2E8F0] rounded-lg focus:border-[#4338CA] outline-none text-[#0F172A] w-64"
            />
          </div>

          <select
            value={filterCourse}
            onChange={(e) => setFilterCourse(e.target.value)}
            className="text-xs bg-white border border-[#E2E8F0] rounded-lg px-3 py-1.5 focus:border-[#4338CA] outline-none text-[#0F172A]"
          >
            <option value="all">All Courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void generatePractice()}
            disabled={isGenerating || courses.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] disabled:opacity-60 rounded-lg transition-colors shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isGenerating ? 'Generating...' : 'Generate AI Practice'}
          </button>
          <button
            type="button"
            onClick={() => setShowAssignmentGenerator(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#4338CA] bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Create my own assignment
          </button>
        </div>
      </div>
      {generationError && (
        <p role="alert" className="text-xs text-[#B91C1C]">{generationError}</p>
      )}

      {/* Assessment Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filtered.map((asmt) => {
          const hasAttempted = asmt.attemptsCount > 0;
          const passed = asmt.bestScore !== undefined && asmt.bestScore >= asmt.passingScore;

          return (
            <div
              key={asmt.id}
              className="p-6 bg-white border border-[#E2E8F0] rounded-xl hover:border-slate-300 transition-all shadow-xs flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#4338CA] bg-indigo-50 px-2 py-0.5 rounded">
                      {asmt.courseCode}
                    </span>
                    <span className="text-xs text-[#64748B]">{asmt.difficulty}</span>
                    {asmt.aiGenerated && (
                      <span className="text-xs text-[#4338CA] bg-indigo-50 px-2 py-0.5 rounded">
                        AI Practice · Not Official
                      </span>
                    )}
                  </div>

                  {hasAttempted && (
                    <span
                      className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded ${
                        passed
                          ? 'text-[#15803D] bg-green-50'
                          : 'text-[#B91C1C] bg-red-50'
                      }`}
                    >
                      Best: {asmt.bestScore}%
                    </span>
                  )}
                </div>

                <h2 className="text-sm font-semibold text-[#0F172A]">
                  {asmt.title}
                </h2>

                <p className="text-xs text-[#64748B]">
                  Focus Area: <strong className="text-[#334155]">{asmt.topic}</strong>
                </p>

                <div className="flex items-center gap-4 text-xs text-[#64748B] pt-1">
                  <div className="flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>{asmt.questionCount} Questions</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>{asmt.durationMinutes} min limit</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>Pass: {asmt.passingScore}%</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-[#F1F5F9] mt-6 flex items-center justify-between">
                <span className="text-xs text-[#64748B]">
                  {hasAttempted
                    ? `${asmt.attemptsCount} attempt${asmt.attemptsCount > 1 ? 's' : ''} on record`
                    : 'Not yet attempted'}
                </span>

                <button
                  onClick={() => onStartQuiz(asmt)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] rounded-lg transition-colors shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{hasAttempted ? 'Retake Quiz' : 'Start Assessment'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
