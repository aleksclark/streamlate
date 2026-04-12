import { useState, useRef, useEffect } from 'react';

interface PinPromptProps {
  sessionName: string;
  error?: string;
  onSubmit: (pin: string) => void;
  onBack: () => void;
}

export function PinPrompt({ sessionName, error, onSubmit, onBack }: PinPromptProps) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (error) {
      setDigits(['', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  }, [error]);

  function handleChange(index: number, value: string) {
    if (!/^\d?$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newDigits.every(d => d.length === 1)) {
      onSubmit(newDigits.join(''));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length === 4) {
      const newDigits = pasted.split('');
      setDigits(newDigits);
      onSubmit(pasted);
    }
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-16 text-center">
      <h2 className="text-xl font-medium mb-2" data-testid="pin-heading">Enter PIN</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">{sessionName} requires a PIN to listen.</p>

      <div className="flex justify-center gap-3 mb-4" data-testid="pin-input">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={handlePaste}
            className="w-14 h-14 text-center text-2xl bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:border-blue-500 focus:outline-none"
            data-testid={`pin-digit-${i}`}
          />
        ))}
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-4" data-testid="pin-error">{error}</p>
      )}

      <button
        onClick={onBack}
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mt-4"
        data-testid="pin-back"
      >
        ← Back to sessions
      </button>
    </div>
  );
}
