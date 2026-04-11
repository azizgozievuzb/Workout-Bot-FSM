import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import './OnboardingFlow.css';

// --- Animation variants ---
const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0 }),
};

const transition = { type: 'spring' as const, stiffness: 300, damping: 30 };

// --- Types ---
interface StepProps {
  onNext: (data?: Record<string, any>) => void;
}

type OnboardingStep = 'survey' | 'photo';

const STEP_ORDER: OnboardingStep[] = ['survey', 'photo'];

// ============================================================
// STEP 1: Survey (determines startingWindow)
// ============================================================
const SURVEY_QUESTIONS = [
  {
    question: 'Как часто вы тренируетесь?',
    options: [
      { label: 'Никогда', value: 0 },
      { label: '1–2 раза в неделю', value: 1 },
      { label: '3+ раз в неделю', value: 2 },
    ],
  },
  {
    question: 'Сколько отжиманий можете сделать за раз?',
    options: [
      { label: '0–5', value: 0 },
      { label: '6–15', value: 1 },
      { label: '16+', value: 2 },
    ],
  },
  {
    question: 'Ваш уровень физической подготовки?',
    options: [
      { label: 'Начинающий', value: 0 },
      { label: 'Средний', value: 1 },
      { label: 'Продвинутый', value: 2 },
    ],
  },
];

const SurveyStep: React.FC<StepProps> = ({ onNext }) => {
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);

  const handleAnswer = (value: number) => {
    const next = [...answers, value];
    if (qIndex < SURVEY_QUESTIONS.length - 1) {
      setAnswers(next);
      setQIndex(qIndex + 1);
    } else {
      const total = next.reduce((a, b) => a + b, 0);
      // 0-2 → beginner, 3-4 → intermediate, 5-6 → advanced
      const level = total <= 2 ? 'beginner' : total <= 4 ? 'intermediate' : 'advanced';
      onNext({ survey_answers: next, starting_level: level });
    }
  };

  const q = SURVEY_QUESTIONS[qIndex];

  return (
    <div className="onb-step">
      <div className="onb-progress">
        {SURVEY_QUESTIONS.map((_, i) => (
          <div key={i} className={`onb-progress-dot ${i <= qIndex ? 'active' : ''}`} />
        ))}
      </div>
      <h2 className="onb-title">{q.question}</h2>
      <div className="onb-buttons">
        {q.options.map((opt) => (
          <button key={opt.value} className="onb-btn" onClick={() => handleAnswer(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// STEP 2: Photo (stub — skip for now)
// ============================================================
const PhotoStep: React.FC<StepProps> = ({ onNext }) => (
  <div className="onb-step">
    <h2 className="onb-title">Фото профиля</h2>
    <p className="onb-subtitle">Загрузите селфи для аватара</p>
    <div className="onb-photo-placeholder">
      <span className="onb-photo-icon">📷</span>
    </div>
    <div className="onb-buttons">
      <button className="onb-btn onb-btn--secondary" onClick={() => onNext({})}>
        Пропустить
      </button>
    </div>
  </div>
);

// ============================================================
// MAIN FLOW
// ============================================================
const OnboardingFlow: React.FC = () => {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [collectedData, setCollectedData] = useState<Record<string, any>>({});
  const { setAuth, token } = useAuthStore();

  const currentStep = STEP_ORDER[stepIndex];

  const handleNext = useCallback(
    async (data?: Record<string, any>) => {
      const merged = { ...collectedData, ...data };
      setCollectedData(merged);

      // Send update to backend
      try {
        await api.put('/users/me', data);
      } catch {
        // Non-blocking — continue onboarding even if update fails
      }

      if (stepIndex < STEP_ORDER.length - 1) {
        setDirection(1);
        setStepIndex(stepIndex + 1);
      } else {
        // Onboarding complete
        try {
          await api.put('/users/me', { onboarding_done: true });
        } catch { /* silent */ }
        setAuth(token!, 'player', true);
      }
    },
    [stepIndex, collectedData, setAuth, token]
  );

  const StepComponent = {
    survey: SurveyStep,
    photo: PhotoStep,
  }[currentStep];

  return (
    <div className="onb-container">
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={currentStep}
          className="onb-card"
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
        >
          <StepComponent onNext={handleNext} />
        </motion.div>
      </AnimatePresence>

      {/* Step indicator */}
      <div className="onb-step-indicator">
        {STEP_ORDER.map((_, i) => (
          <div key={i} className={`onb-step-dot ${i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}`} />
        ))}
      </div>
    </div>
  );
};

export default OnboardingFlow;
