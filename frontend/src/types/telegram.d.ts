interface Window {
  Telegram?: {
    WebApp?: {
      initData: string;
      initDataUnsafe: Record<string, any>;
      ready: () => void;
      expand: () => void;
    };
  };
}
