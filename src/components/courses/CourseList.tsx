import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Filter,
  User,
  Clock,
  ArrowRight,
  Sparkles,
  Layers
} from 'lucide-react';
import { Course } from '../../types';

interface CourseListProps {
  courses: Course[];
  onSelectCourse: (course: Course) => void;
}

export const CourseList: React.FC<CourseListProps> = ({ courses, onSelectCourse }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProgress, setFilterProgress] = useState<'all' | 'in_progress' | 'completed'>('all');

  const filtered = courses.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.instructor.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filterProgress === 'in_progress') return c.progress < 100;
    if (filterProgress === 'completed') return c.progress === 100;
    return true;
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">
            Enrolled Academic Courses
          </h1>
          <p className="text-xs text-[#64748B] mt-1">
            Curriculum modules synchronized with the student agent knowledge graph
          </p>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by code, title, or instructor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-white border border-[#E2E8F0] rounded-lg focus:border-[#4338CA] outline-none text-[#0F172A] w-64"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setFilterProgress('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterProgress === 'all'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterProgress('in_progress')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterProgress === 'in_progress'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              In Progress
            </button>
          </div>
        </div>
      </div>

      {/* Course Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((course) => (
          <div
            key={course.id}
            onClick={() => onSelectCourse(course)}
            className="p-6 bg-white border border-[#E2E8F0] rounded-xl hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#4338CA] bg-indigo-50 px-2 py-0.5 rounded">
                  {course.code}
                </span>
                <span className="text-xs text-[#64748B]">{course.credits} Credits</span>
              </div>

              <h2 className="text-sm font-semibold text-[#0F172A] line-clamp-1">
                {course.title}
              </h2>

              <p className="text-xs text-[#64748B] line-clamp-3 leading-relaxed">
                {course.description}
              </p>
            </div>

            <div className="pt-6 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">Curriculum Mastery</span>
                  <span className="font-semibold text-[#0F172A] tabular-nums">
                    {course.progress}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[#4338CA] h-1.5 rounded-full"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-xs text-[#64748B]">
                <div className="flex items-center gap-1.5 truncate">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{course.instructor}</span>
                </div>
                <div className="inline-flex items-center gap-1 text-[#4338CA] font-semibold">
                  <span>View Details</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
