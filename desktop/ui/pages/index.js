// Every page: its title, icon and key (the 0.2 keys keep working), and the sidebar (REDESIGN §3, round 5).
import now from './now.js';
import schedule from './schedule.js';
import attendance from './attendance.js';
import notes from './notes.js';
import note from './note.js';
import drive from './drive.js';
import alarms from './alarms.js';
import reminders from './reminders.js';
import timers from './timers.js';
import world from './world.js';
import assistant from './assistant.js';
import settings from './settings.js';
import login from './login.js';

export const PAGES = {
  now: { title: 'Now', icon: 'now', key: '1', ...now },
  schedule: { title: 'Schedule', icon: 'schedule', key: '2', ...schedule },
  notes: { title: 'Notes', icon: 'notes', key: '3', ...notes },
  alarms: { title: 'Alarms', icon: 'bell', key: '4', ...alarms },
  timers: { title: 'Timers', icon: 'timer', key: '5', ...timers },
  world: { title: 'World clock', icon: 'globe', key: '6', ...world },
  attendance: { title: 'Attendance', icon: 'attend', key: '7', ...attendance },
  drive: { title: 'Drive', icon: 'drive', key: '8', ...drive },
  assistant: { title: 'Assistant', icon: 'assistant', key: '9', ...assistant },
  settings: { title: 'Settings', icon: 'gear', key: '0', ...settings },
  reminders: { title: 'Reminders', icon: 'reminder', key: '', ...reminders },
  note: { title: 'Note', icon: 'notes', hidden: true, ...note },
  login: { title: 'Sign in', icon: 'person', hidden: true, ...login },
};

// The sidebar, top to bottom: the phone's tabs, then the Assistant. A group's pages show under it while one of
// them is open (Schedule: the calendar and Attendance; Time: Alarms, Reminders, Timers, World clock).
export const NAV = [
  { id: 'now' },
  { id: 'schedule', subs: ['schedule', 'attendance'] },
  { id: 'notes' },
  { id: 'drive' },
  { id: 'time', page: false, title: 'Time', icon: 'time', subs: ['alarms', 'reminders', 'timers', 'world'] },
  { gap: true },
  { id: 'assistant' },
];
