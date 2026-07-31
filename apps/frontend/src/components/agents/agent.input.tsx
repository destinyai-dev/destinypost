import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCopilotContext, useCopilotReadable } from '@copilotkit/react-core';
import AutoResizingTextarea from '@gitroom/frontend/components/agents/agent.textarea';
import { useChatContext } from '@copilotkit/react-ui';
import { InputProps } from '@copilotkit/react-ui/dist/components/chat/props';
import { PlusIcon } from '@gitroom/frontend/components/ui/icons';
const MAX_NEWLINES = 6;

export const Input = ({
  inProgress,
  onSend,
  isVisible = false,
  onStop,
  onUpload,
  hideStopButton = false,
  onChange,
  onInstagramProfile,
}: InputProps & {
  onChange: (value: string) => void;
  onInstagramProfile?: (username: string) => void;
}) => {
  const context = useChatContext();
  const copilotContext = useCopilotContext();
  const showPoweredBy = !copilotContext.copilotApiConfig?.publicApiKey;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentRef = useRef<HTMLDivElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [instagramFormOpen, setInstagramFormOpen] = useState(false);
  const [instagramHandle, setInstagramHandle] = useState('');
  const [instagramError, setInstagramError] = useState('');

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        attachmentRef.current &&
        !attachmentRef.current.contains(event.target as Node)
      ) {
        setAttachmentMenuOpen(false);
        setInstagramFormOpen(false);
        setInstagramError('');
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const handleDivClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    // If the user clicked a button or inside a button, don't focus the textarea
    if (target.closest('button')) return;

    // If the user clicked the textarea, do nothing (it's already focused)
    if (target.tagName === 'TEXTAREA') return;

    // Otherwise, focus the textarea
    textareaRef.current?.focus();
  };

  const [text, setText] = useState('');
  const send = () => {
    if (inProgress) return;
    onSend(text);
    setText('');

    textareaRef.current?.focus();
  };

  const isInProgress = inProgress;
  const buttonIcon =
    isInProgress && !hideStopButton
      ? context.icons.stopIcon
      : context.icons.sendIcon;

  const canSend = useMemo(() => {
    const interruptEvent = copilotContext.langGraphInterruptAction?.event;
    const interruptInProgress =
      interruptEvent?.name === 'LangGraphInterruptEvent' &&
      !interruptEvent?.response;

    return !isInProgress && text.trim().length > 0 && !interruptInProgress;
  }, [copilotContext.langGraphInterruptAction?.event, isInProgress, text]);

  const canStop = useMemo(() => {
    return isInProgress && !hideStopButton;
  }, [isInProgress, hideStopButton]);

  const sendDisabled = !canSend && !canStop;

  const submitInstagram = () => {
    const username = instagramHandle
      .trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/^@/, '')
      .split(/[/?#]/)[0]
      .toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(username)) {
      setInstagramError('Digite um arroba valido, sem espacos.');
      return;
    }
    onInstagramProfile?.(username);
    setInstagramHandle('');
    setInstagramError('');
    setInstagramFormOpen(false);
    setAttachmentMenuOpen(false);
  };

  return (
    <div
      className={`copilotKitInputContainer ${
        showPoweredBy ? 'poweredByContainer' : ''
      }`}
    >
      <div className="copilotKitInput" onClick={handleDivClick}>
        <AutoResizingTextarea
          ref={textareaRef}
          placeholder={context.labels.placeholder}
          autoFocus={false}
          maxRows={MAX_NEWLINES}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
            setText(event.target.value);
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
              event.preventDefault();
              if (canSend) {
                send();
              }
            }
          }}
        />
        <div className="copilotKitInputControls">
          {onInstagramProfile && (
            <div className="relative" ref={attachmentRef}>
              <button
                type="button"
                onClick={() => {
                  setAttachmentMenuOpen((current) => !current);
                  setInstagramFormOpen(false);
                  setInstagramError('');
                }}
                className="copilotKitInputControlButton"
                aria-label="Adicionar contexto"
                title="Adicionar contexto"
                disabled={inProgress}
              >
                <PlusIcon size={18} />
              </button>

              {attachmentMenuOpen ? (
                <div className="absolute bottom-[44px] left-0 z-[80] w-[290px] rounded-[8px] border border-fifth bg-newBgColorInner shadow-lg text-textColor overflow-hidden">
                  {!instagramFormOpen ? (
                    <button
                      type="button"
                      onClick={() => setInstagramFormOpen(true)}
                      className="w-full min-h-[56px] flex items-center gap-[12px] px-[14px] hover:bg-boxHover text-left"
                    >
                      <img
                        src="/icons/platforms/instagram.png"
                        alt=""
                        className="w-[28px] h-[28px]"
                      />
                      <span>
                        <strong className="block text-[14px]">
                          Perfil do Instagram
                        </strong>
                        <span className="block text-[11px] opacity-60 mt-[2px]">
                          Mapear DNA, nicho e ideias
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="p-[14px]">
                      <div className="flex items-center gap-[9px] mb-[12px]">
                        <img
                          src="/icons/platforms/instagram.png"
                          alt=""
                          className="w-[25px] h-[25px]"
                        />
                        <div>
                          <div className="font-semibold text-[14px]">
                            Adicionar referencia
                          </div>
                          <div className="text-[11px] opacity-60">
                            Pode ser seu perfil ou outro perfil publico.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center h-[42px] rounded-[6px] border border-fifth bg-newBgColor px-[10px] focus-within:border-btnText">
                        <span className="opacity-55">@</span>
                        <input
                          autoFocus
                          value={instagramHandle}
                          onChange={(event) => {
                            setInstagramHandle(event.target.value);
                            setInstagramError('');
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              submitInstagram();
                            }
                          }}
                          placeholder="usuario"
                          className="flex-1 min-w-0 bg-transparent outline-none px-[5px] text-[14px]"
                        />
                      </div>
                      {instagramError ? (
                        <div className="text-red-400 text-[11px] mt-[6px]">
                          {instagramError}
                        </div>
                      ) : null}
                      <div className="grid grid-cols-[90px_1fr] gap-[8px] mt-[12px]">
                        <button
                          type="button"
                          onClick={() => {
                            setInstagramFormOpen(false);
                            setInstagramError('');
                          }}
                          className="h-[38px] rounded-[6px] border border-fifth text-[13px]"
                        >
                          Voltar
                        </button>
                        <button
                          type="button"
                          onClick={submitInstagram}
                          className="h-[38px] rounded-[6px] bg-btnPrimary text-white text-[13px] font-medium"
                        >
                          Mapear perfil
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
          {onUpload && (
            <button onClick={onUpload} className="copilotKitInputControlButton">
              {context.icons.uploadIcon}
            </button>
          )}

          <div style={{ flexGrow: 1 }} />
          <button
            disabled={sendDisabled}
            onClick={isInProgress && !hideStopButton ? onStop : send}
            data-copilotkit-in-progress={inProgress}
            data-test-id={
              inProgress
                ? 'copilot-chat-request-in-progress'
                : 'copilot-chat-ready'
            }
            className="copilotKitInputControlButton"
          >
            {buttonIcon}
          </button>
        </div>
      </div>
    </div>
  );
};
