import React, { useState } from 'react';
import Markdown from 'react-markdown';
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  HelpCircle,
  Loader2,
  AlertCircle,
  Lightbulb,
} from 'lucide-react';
import { BirdSpecies } from '../types';

interface Message {
  sender: 'user' | 'assistant';
  text: string;
  source?: string;
  timestamp: string;
}

interface SpeciesAssistantModalProps {
  species: BirdSpecies;
  onClose: () => void;
}

export const SpeciesAssistantModal: React.FC<SpeciesAssistantModalProps> = ({
  species,
  onClose,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'assistant',
      text: `Hello! I am your Avian Bioacoustics Field Guide. Ask me anything about **${species.commonName}** (*${species.scientificName}*), including vocal signatures, peak singing hours, habitat niches, or field identification techniques.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const starterQuestions = [
    `What time of day is ${species.commonName} most acoustically active?`,
    `How do I distinguish its ${species.vocalType.toLowerCase()} from similar birds?`,
    `What are the critical habitat threats affecting this species?`,
    `Why is this bird scored as a bioindicator with sensitivity rating ${species.sensitivityScore ?? 7}/10?`,
  ];

  const handleSendQuestion = async (questionText: string) => {
    const q = questionText.trim();
    if (!q || isLoading) return;

    setError(null);
    setInputQuery('');
    const userMsg: Message = {
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/species-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speciesId: species.id,
          question: q,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: Message = {
        sender: 'assistant',
        text: data.answer || 'No response available.',
        source: data.source,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error('Error querying species assistant:', err);
      setError('Unable to reach the assistant. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="species-assistant-overlay"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        id="species-assistant-modal"
        className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-2xl w-full h-[640px] max-h-[90vh] flex flex-col shadow-2xl text-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 px-5 border-b border-emerald-500/20 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                Field Guide AI • {species.commonName}
              </h3>
              <p className="text-xs text-emerald-400 italic">
                {species.scientificName} ({species.family})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-950/40">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.sender === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-emerald-600 text-white rounded-tr-none'
                    : 'bg-slate-800/90 text-slate-200 border border-emerald-500/20 rounded-tl-none shadow-md'
                }`}
              >
                {m.sender === 'assistant' ? (
                  <div className="prose prose-invert prose-xs max-w-none text-slate-200 space-y-2">
                    <Markdown>{m.text}</Markdown>
                  </div>
                ) : (
                  <span>{m.text}</span>
                )}
                <div
                  className={`mt-1.5 text-[10px] ${
                    m.sender === 'user' ? 'text-emerald-200 text-right' : 'text-slate-400'
                  }`}
                >
                  {m.timestamp}
                  {m.source && (
                    <span className="ml-2 px-1.5 py-0.2 rounded bg-slate-900/60 font-mono text-[9px] text-emerald-400">
                      {m.source}
                    </span>
                  )}
                </div>
              </div>
              {m.sender === 'user' && (
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3 items-center text-xs text-slate-400">
              <div className="w-7 h-7 rounded-full bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
              <span className="italic">Consulting ornithological bioacoustics records...</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Starter Suggested Questions */}
        <div className="p-3 bg-slate-900/90 border-t border-emerald-500/15">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold mb-2">
            <Lightbulb className="w-3.5 h-3.5" />
            <span>Suggested Questions:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {starterQuestions.map((sq, i) => (
              <button
                key={i}
                onClick={() => handleSendQuestion(sq)}
                disabled={isLoading}
                className="text-[11px] px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 hover:text-emerald-300 rounded-lg border border-slate-700 transition truncate max-w-full text-left"
              >
                {sq}
              </button>
            ))}
          </div>
        </div>

        {/* Query Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendQuestion(inputQuery);
          }}
          className="p-3 bg-slate-950 border-t border-emerald-500/20 flex items-center gap-2"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={`Ask a question about ${species.commonName}...`}
            disabled={isLoading}
            className="flex-1 bg-slate-900 border border-emerald-500/25 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || isLoading}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ask</span>
          </button>
        </form>
      </div>
    </div>
  );
};
