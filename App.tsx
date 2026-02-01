import React, { useState, useEffect, useRef } from 'react';
import { Subject, AppSettings, DayOfWeek } from './types';
import { SubjectCard } from './components/SubjectCard';
import { AddSubjectModal } from './components/AddSubjectModal';
import { CalendarView } from './components/CalendarView';
import { NotificationSettings as SettingsView } from './components/NotificationSettings';
import { Plus, GraduationCap, LayoutGrid, Calendar, Settings, PieChart, Sparkles } from 'lucide-react';
import { getSubjectsForDate, getLocalISOString, isEventDay } from './utils/calculations';
import { triggerHaptic } from './utils/haptics';

const LOCAL_STORAGE_KEY = 'smartskip_data_v1';
const SETTINGS_KEY = 'smartskip_settings_v2';

// --- macOS Dock Implementation ---

interface DockIconProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; // Pass the event
  mouseX: number | null;
  dockRef: React.RefObject<HTMLDivElement>;
}

const DockIcon: React.FC<DockIconProps> = ({ icon, label, isActive, onClick, mouseX, dockRef }) => {
  const iconRef = useRef<HTMLButtonElement>(null);
  
  // Professional macOS Configuration
  const baseSize = 40;     // Resting size (Compact)
  const maxSize = 75;      // Max expanded size
  const distanceLimit = 160; // Influence range (The "Gaussian" spread width)
  
  const [dimensions, setDimensions] = useState({ size: baseSize, mag: 0 });

  useEffect(() => {
    // 1. Idle State: If mouse is not on dock, revert to base size
    if (mouseX === null || !iconRef.current || !dockRef.current) {
      setDimensions({ size: baseSize, mag: 0 });
      return;
    }

    const rect = iconRef.current.getBoundingClientRect();
    const iconCenterX = rect.left + rect.width / 2;
    
    // 2. Physics Calculation
    const distance = mouseX - iconCenterX;
    
    if (Math.abs(distance) < distanceLimit) {
      const normalized = Math.abs(distance) / distanceLimit;
      
      // 3. Interpolation Curve: Cosine Bell Curve
      // This creates that specific "round" feeling of the macOS dock wave
      // (val goes from 1.0 at center to 0.0 at limit)
      const val = Math.cos(normalized * (Math.PI / 2));
      
      // Linear interpolation between Base and Max based on the curve value
      const newSize = baseSize + (maxSize - baseSize) * (val * val); // Square for steeper ease-in
      setDimensions({ size: newSize, mag: val });
    } else {
      setDimensions({ size: baseSize, mag: 0 });
    }
  }, [mouseX, dockRef]);

  // CSS Logic:
  // When interacting (mouseX !== null), we disable transition for instant tracking.
  // When leaving (mouseX === null), we use a spring-like cubic-bezier for the "snap back".
  const isInteracting = mouseX !== null;
  const transitionClass = isInteracting 
    ? 'transition-none' 
    : 'transition-[width,height,transform,background-color] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]';

  const sizeStyle = {
    width: `${dimensions.size}px`,
    height: `${dimensions.size}px`,
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    triggerHaptic('light');
    onClick(e); // Pass the event up
  };

  return (
    // Alignment Wrapper: Anchors to bottom (items-end in parent), minimal margins
    <div className="flex flex-col items-center justify-end mb-2.5 group relative z-10 perspective-1000">
       
       {/* Tooltip: Floats dynamically based on magnification */}
       <div 
          className="absolute -top-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20"
          style={{ 
            transform: `translateY(${dimensions.mag * -20}px) translateX(-50%)`, 
            left: '50%'
          }} 
        >
          <div className="bg-[#1e1e1e]/90 backdrop-blur-md text-white/90 text-[10px] font-medium px-2.5 py-1 rounded-[6px] border border-white/10 shadow-xl whitespace-nowrap">
            {label}
          </div>
       </div>

      <button 
        ref={iconRef}
        onClick={handleClick}
        style={sizeStyle}
        className={`
          relative flex items-center justify-center rounded-[14px]
          will-change-[width,height,transform]
          border
          ${transitionClass}
          ${isActive 
            ? 'bg-white/20 border-white/10 shadow-[inset_0_0_12px_rgba(255,255,255,0.15)]' 
            : 'bg-white/5 border-white/5 hover:bg-white/10'
          }
        `}
      >
        <div 
           // Icon Inner Scale: Subtle parallax effect
           className={`transition-all duration-300 ${isActive ? 'text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]' : 'text-gray-400'}`}
        >
          {React.cloneElement(icon as React.ReactElement<any>, { 
            size: dimensions.size * 0.5, 
            strokeWidth: isActive ? 2.5 : 2
          })}
        </div>
      </button>
    </div>
  );
};

// --- Main App ---

const App: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.map((s: any) => ({
      ...s,
      id: s.id || `restored-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    })) : [];
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {
      notificationsEnabled: false,
      dailyReminder: true,
      dailyReminderTime: '20:00',
      classReminders: true,
      targetPercentage: 0.75 // Default 75%
    };
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | undefined>(undefined);
  
  // View State & Animation State
  const [currentView, setCurrentView] = useState<'dashboard' | 'calendar' | 'settings'>('dashboard');
  const [animOrigin, setAnimOrigin] = useState<{x: number | string, y: number | string}>({ x: '50%', y: '100%' });
  
  const dockRef = useRef<HTMLDivElement>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);

  // Refs for Notification Deduplication
  const lastDailyReminderRef = useRef<string>('');
  const sentClassRemindersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(subjects));
  }, [subjects]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // --- Notification Engine ---
  useEffect(() => {
    if (!settings.notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;

    const checkNotifications = () => {
      const now = new Date();
      const todayStr = getLocalISOString(now);
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTimeInMinutes = currentHours * 60 + currentMinutes;

      // Reset cache if day changed
      if (lastDailyReminderRef.current !== '' && lastDailyReminderRef.current !== todayStr) {
          sentClassRemindersRef.current.clear();
      }

      // 1. Daily Reminder
      if (settings.dailyReminder && settings.dailyReminderTime) {
          const [remH, remM] = settings.dailyReminderTime.split(':').map(Number);
          if (currentHours === remH && currentMinutes === remM) {
              if (lastDailyReminderRef.current !== todayStr) {
                  new Notification("SmartSkip Daily Check", {
                      body: "Don't forget to log your attendance today!",
                      icon: "/favicon.ico"
                  });
                  lastDailyReminderRef.current = todayStr;
              }
          }
      }

      // 2. Class Reminders (15 mins before)
      if (settings.classReminders) {
          subjects.forEach(sub => {
              if (!sub.startTime) return;

              // Validate if class exists today
              const validation = isEventDay(todayStr, sub);
              if (!validation.isValid) return;

              const [startH, startM] = sub.startTime.split(':').map(Number);
              const startTimeInMinutes = startH * 60 + startM;
              const diff = startTimeInMinutes - currentTimeInMinutes;

              // Check if exactly 15 minutes remaining
              if (diff === 15) {
                  const key = `${sub.id}-${todayStr}`;
                  if (!sentClassRemindersRef.current.has(key)) {
                      new Notification(`Upcoming Class: ${sub.name}`, {
                          body: `Starting at ${sub.startTime} (in 15 mins)`,
                          icon: "/favicon.ico"
                      });
                      sentClassRemindersRef.current.add(key);
                  }
              }
          });
      }
    };

    // Calculate time until next minute start to align interval
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50; 
    
    // Initial check
    checkNotifications();

    let intervalId: ReturnType<typeof setInterval>;
    const timeoutId = setTimeout(() => {
        checkNotifications();
        intervalId = setInterval(checkNotifications, 60000); // Check every minute
    }, msUntilNextMinute);

    return () => {
        clearTimeout(timeoutId);
        if (intervalId) clearInterval(intervalId);
    };
  }, [settings, subjects]);


  const handleSaveSubject = (subject: Subject) => {
    if (editingSubject) {
      setSubjects(prev => prev.map(s => s.id === subject.id ? subject : s));
    } else {
      setSubjects(prev => [...prev, subject]);
    }
    setEditingSubject(undefined);
  };

  const handleUpdateSubject = (updated: Subject) => {
    setSubjects(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const handleDeleteSubject = (id: string) => {
    setSubjects(prev => prev.filter(s => s.id !== id));
  };

  const handleEditSubject = (subject: Subject) => {
    setEditingSubject(subject);
    setIsModalOpen(true);
  };

  const handleOpenModal = () => {
    triggerHaptic('medium');
    setEditingSubject(undefined);
    setIsModalOpen(true);
  };

  const handleImportSubjects = (importedSubjects: Subject[]) => {
      setSubjects(importedSubjects);
      triggerHaptic('success');
      alert('Data restored successfully.');
      setCurrentView('dashboard');
  };

  // --- GENIE NAVIGATION HANDLER ---
  const handleViewChange = (view: typeof currentView, e: React.MouseEvent<HTMLButtonElement>) => {
      // 1. Get exact position of the clicked icon center
      const rect = e.currentTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // 2. Set the Transform Origin for the incoming view to be that center point
      setAnimOrigin({ x: centerX, y: centerY });
      
      // 3. Change View (triggers the re-render with animation)
      setCurrentView(view);
  };

  return (
    <div className="min-h-screen pb-32 relative overflow-hidden">
      
      {/* Minimal Header */}
      <header className="fixed top-0 left-0 right-0 z-40 px-6 py-6 bg-gradient-to-b from-black/80 to-transparent pointer-events-none transition-all duration-500">
        <div className="max-w-3xl mx-auto flex justify-between items-center pointer-events-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/5 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/10 shadow-lg group">
               <GraduationCap className="text-[#0A84FF] transition-transform duration-500 group-hover:rotate-12" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight drop-shadow-sm">SmartSkip</h1>
              <p className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase opacity-80">Attendance OS</p>
            </div>
          </div>
          {currentView === 'dashboard' && (
             <button 
                onClick={handleOpenModal} 
                className="w-10 h-10 bg-[#0A84FF] hover:bg-[#0071e3] text-white rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(10,132,255,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 border border-white/20"
             >
               <Plus size={22} strokeWidth={2.5} />
             </button>
          )}
        </div>
      </header>

      {/* Main Content Area with GENIE ANIMATION CONTAINER */}
      <main className="max-w-3xl mx-auto px-4 pt-28 perspective-2000">
        {/* 
            The KEY is crucial. It forces React to destroy the old DOM node and create a new one,
            firing the CSS animation from scratch.
            style.transformOrigin dynamically maps the 'Genie' effect to the clicked icon.
        */}
        <div 
            key={currentView} 
            className="animate-mac-genie-open will-change-transform backface-visibility-hidden"
            style={{ 
                transformOrigin: `${animOrigin.x}px ${animOrigin.y}px` 
            }}
        >
          {currentView === 'dashboard' && (
            subjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center mt-20 text-center space-y-8 animate-mac-window-open select-none">
                 {/* Empty State Graphic */}
                 <div className="relative group cursor-default">
                    <div className="absolute inset-0 bg-[#0A84FF]/20 blur-[80px] rounded-full opacity-50 group-hover:opacity-80 transition-opacity duration-1000"></div>
                    <div className="relative w-40 h-40 rounded-[2.5rem] pro-glass flex items-center justify-center transform transition-transform duration-500 group-hover:-translate-y-2 group-hover:rotate-1">
                       <PieChart strokeWidth={1} size={72} className="text-white/80 drop-shadow-lg" />
                       <div className="absolute -right-5 -top-5 w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0A84FF] to-[#0077ED] flex items-center justify-center shadow-[0_8px_20px_rgba(10,132,255,0.4)] transform rotate-12 group-hover:rotate-[24deg] group-hover:scale-110 transition-all duration-500 border border-white/20">
                          <Plus size={32} className="text-white" strokeWidth={3} />
                       </div>
                    </div>
                 </div>

                 <div className="space-y-3 max-w-sm mx-auto">
                   <h2 className="text-3xl font-bold text-white tracking-tight">Ready to Track?</h2>
                   <p className="text-gray-400 text-base leading-relaxed font-medium">
                     Add your classes to start the predictive engine. We'll handle the holiday math and bunk calculations based on your {settings.targetPercentage * 100}% target.
                   </p>
                 </div>
              </div>
            ) : (
              <div className="space-y-6">
                {subjects.map(subject => (
                  <SubjectCard
                    key={subject.id}
                    subject={subject}
                    onUpdate={handleUpdateSubject}
                    onDelete={handleDeleteSubject}
                    onEdit={handleEditSubject}
                    targetPercentage={settings.targetPercentage} // Pass global setting
                  />
                ))}
              </div>
            )
          )}

          {currentView === 'calendar' && (
            <CalendarView subjects={subjects} targetPercentage={settings.targetPercentage} />
          )}

          {currentView === 'settings' && (
            <SettingsView 
                settings={settings} 
                onUpdate={setSettings} 
                subjects={subjects} 
                onImport={handleImportSubjects}
            />
          )}
        </div>
      </main>

      {/* 
          --- macOS DOCK CONTAINER (Big Sur Style) --- 
          Height: 58px (Compact vertical profile)
          Glass: Darker, deeper blur
          Shape: Fully rounded pills
          Spacing: Tighter gaps, specific padding
      */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex justify-center w-auto">
         <div 
           ref={dockRef}
           onMouseMove={(e) => setMouseX(e.clientX)}
           onMouseLeave={() => setMouseX(null)}
           className="
              relative flex items-end gap-2.5 px-3 h-[58px]
              bg-[#1c1c1e]/40 backdrop-blur-2xl rounded-[20px]
              border border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_40px_rgba(0,0,0,0.6)]
              will-change-transform
           "
         >
            <DockIcon 
               icon={<LayoutGrid />} 
               label="Dashboard" 
               isActive={currentView === 'dashboard'} 
               onClick={(e) => handleViewChange('dashboard', e)}
               mouseX={mouseX}
               dockRef={dockRef}
            />
            <DockIcon 
               icon={<Calendar />} 
               label="Calendar" 
               isActive={currentView === 'calendar'} 
               onClick={(e) => handleViewChange('calendar', e)}
               mouseX={mouseX}
               dockRef={dockRef}
            />
            
            {/* 
               Separator: Fixed vertical line
            */}
            <div className="w-[1px] h-6 bg-white/10 mx-1 border-r border-black/30 self-end mb-[17px]"></div>

            <DockIcon 
               icon={<Settings />} 
               label="Preferences" 
               isActive={currentView === 'settings'} 
               onClick={(e) => handleViewChange('settings', e)}
               mouseX={mouseX}
               dockRef={dockRef}
            />
         </div>
      </div>

      <AddSubjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveSubject}
        initialData={editingSubject}
      />
    </div>
  );
};

export default App;