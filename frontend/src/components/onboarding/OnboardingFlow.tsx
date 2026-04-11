import React, { useState, useCallback, useEffect } from 'react';
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

const ENCOURAGEMENTS = [
  'Отличный выбор!',
  'Так держать!',
  'Почти готово...',
];

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
  const [showEncouragement, setShowEncouragement] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleAnswer = (value: number) => {
    if (isTransitioning) return;
    const next = [...answers, value];

    if (qIndex < SURVEY_QUESTIONS.length - 1) {
      setIsTransitioning(true);
      setShowEncouragement(true);
      setAnswers(next);

      // Show encouragement, then transition to next question
      setTimeout(() => {
        setShowEncouragement(false);
        setTimeout(() => {
          setQIndex(qIndex + 1);
          setIsTransitioning(false);
        }, 300);
      }, 1200);
    } else {
      const total = next.reduce((a, b) => a + b, 0);
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

      <AnimatePresence mode="wait">
        {showEncouragement ? (
          <motion.p
            key="encouragement"
            className="onb-encouragement"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.3 }}
          >
            {ENCOURAGEMENTS[qIndex] || ENCOURAGEMENTS[0]}
          </motion.p>
        ) : (
          <motion.div
            key={`q-${qIndex}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
          >
            <h2 className="onb-title">{q.question}</h2>
            <div className="onb-buttons">
              {q.options.map((opt) => (
                <button key={opt.value} className="onb-btn" onClick={() => handleAnswer(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
// WAITING SCREEN — while AI processes the photo
// ============================================================
const WaitingScreen: React.FC = () => (
  <motion.div
    className="onb-step onb-waiting"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.6 }}
  >
    <div className="onb-particles">
      {Array.from({ length: 12 }).map((_, i) => (
        <motion.div
          key={i}
          className="onb-particle"
          animate={{
            y: [0, -30, 0],
            opacity: [0.3, 1, 0.3],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{
            duration: 2 + Math.random() * 1.5,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
          style={{
            left: `${10 + Math.random() * 80}%`,
            top: `${20 + Math.random() * 60}%`,
          }}
        />
      ))}
    </div>
    <h2 className="onb-title">Создаём ваш персональный мир...</h2>
    <p className="onb-subtitle">AI стилизует ваше фото</p>
  </motion.div>
);

// ============================================================
// MAIN FLOW
// ============================================================
const OnboardingFlow: React.FC = () => {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [collectedData, setCollectedData] = useState<Record<string, any>>({});
  const [waitingForPhoto, setWaitingForPhoto] = useState(false);
  const { setAuth, token, photoUrl } = useAuthStore();

  const currentStep = STEP_ORDER[stepIndex];

  // Poll photo_processing status when waiting
  useEffect(() => {
    if (!waitingForPhoto) return;
    let cancelled = false;

    const checkStatus = async () => {
      try {
        const { data } = await api.get('/users/me/photo-status');
        if (!cancelled && data.photo_processing === false) {
          setWaitingForPhoto(false);
          // Complete onboarding
          try {
            await api.put('/users/me', { onboarding_done: true });
          } catch { /* silent */ }
          setAuth(token!, 'player', true);
        }
      } catch { /* silent */ }
    };

    const interval = setInterval(checkStatus, 3000);
    checkStatus();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [waitingForPhoto, setAuth, token]);

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
        // Last step done — check if photo is still processing
        if (photoUrl) {
          try {
            const { data: status } = await api.get('/users/me/photo-status');
            if (status.photo_processing) {
              setWaitingForPhoto(true);
              return;
            }
          } catch { /* silent */ }
        }
        // No photo or processing done — complete immediately
        try {
          await api.put('/users/me', { onboarding_done: true });
        } catch { /* silent */ }
        setAuth(token!, 'player', true);
      }
    },
    [stepIndex, collectedData, setAuth, token, photoUrl]
  );

  if (waitingForPhoto) {
    return (
      <div className="onb-container">
        <WaitingScreen />
      </div>
    );
  }

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
