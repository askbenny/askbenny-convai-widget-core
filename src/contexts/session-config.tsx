import { SessionConfig } from "@elevenlabs/client";
import { ReadonlySignal, useComputed, useSignal } from "@preact/signals";
import { ComponentChildren } from "preact";
import { createContext } from "preact/compat";
import { useAttribute } from "./attributes";
import { useLanguageConfig } from "./language-config";
import { useServerLocation } from "./server-location";
import { useEffect } from "preact/hooks";

import { useContextSafely } from "../utils/useContextSafely";
import { parseBoolAttribute } from "../types/attributes";
import { useTextOnly } from "./widget-config";

type DynamicVariables = Record<string, string | number | boolean>;

// Add function to fetch signed URL
async function fetchSignedUrl(agentId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.askbenny.ca/elevenlabs/signed-url?agentId=${agentId}`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.body?.signedUrl || null;
  } catch (error) {
    console.error("[ConversationalAI] Failed to fetch signed URL:", error);
    return null;
  }
}

const SessionConfigContext =
  createContext<ReadonlySignal<SessionConfig> | null>(null);

interface SessionConfigProviderProps {
  children: ComponentChildren;
}

export function SessionConfigProvider({
  children,
}: SessionConfigProviderProps) {
  const { language } = useLanguageConfig();
  const overridePrompt = useAttribute("override-prompt");
  const overrideFirstMessage = useAttribute("override-first-message");
  const overrideVoiceId = useAttribute("override-voice-id");
  const overrideTextOnly = useAttribute("override-text-only");
  const userId = useAttribute("user-id");
  const overrides = useComputed<SessionConfig["overrides"]>(() => ({
    agent: {
      prompt: {
        prompt: overridePrompt.value,
      },
      firstMessage: overrideFirstMessage.value,
      language: language.value.languageCode,
    },
    tts: {
      voiceId: overrideVoiceId.value,
    },
    conversation: {
      textOnly: parseBoolAttribute(overrideTextOnly.value) ?? undefined,
    },
  }));

  const dynamicVariablesJSON = useAttribute("dynamic-variables");
  const dynamicVariables = useComputed(() => {
    if (dynamicVariablesJSON.value) {
      try {
        return JSON.parse(dynamicVariablesJSON.value) as DynamicVariables;
      } catch (e: any) {
        console.error(
          `[ConversationalAI] Cannot parse dynamic-variables: ${e?.message}`
        );
      }
    }

    return undefined;
  });

  const { webSocketUrl } = useServerLocation();
  const agentId = useAttribute("agent-id");
  const signedUrl = useAttribute("signed-url");
  const textOnly = useTextOnly();

  // Add state for fetched signed URL
  const fetchedSignedUrl = useSignal<string | null>(null);
  const isLoadingSignedUrl = useSignal(false);

  // Fetch signed URL when agentId is available but signedUrl is not
  useEffect(() => {
    if (
      agentId.value &&
      !signedUrl.value &&
      !fetchedSignedUrl.value &&
      !isLoadingSignedUrl.value
    ) {
      isLoadingSignedUrl.value = true;
      fetchSignedUrl(agentId.value).then((url) => {
        fetchedSignedUrl.value = url;
        isLoadingSignedUrl.value = false;
      });
    }
  }, [agentId.value, signedUrl.value]);

  const value = useComputed<SessionConfig | null>(() => {
    const commonConfig = {
      dynamicVariables: dynamicVariables.value,
      overrides: overrides.value,
      connectionDelay: { default: 300 },
      textOnly: textOnly.value,
      connectionType: "websocket" as const,
      userId: userId.value || undefined,
    };

    // If explicit signed URL is provided, use it
    if (signedUrl.value) {
      return {
        signedUrl: signedUrl.value,
        ...commonConfig,
      };
    }

    // If fetched signed URL is available, use it
    if (fetchedSignedUrl.value) {
      return {
        signedUrl: fetchedSignedUrl.value,
        ...commonConfig,
      };
    }

    // If agentId is provided but still loading signed URL, return null to wait
    if (agentId.value && isLoadingSignedUrl.value) {
      return null;
    }

    // Fallback to agentId-based config
    if (agentId.value) {
      return {
        agentId: agentId.value,
        origin: webSocketUrl.value,
        ...commonConfig,
      };
    }

    console.error(
      "[ConversationalAI] Either agent-id or signed-url is required"
    );
    return null;
  });

  if (!value.value) {
    return null;
  }

  return (
    <SessionConfigContext.Provider
      value={value as ReadonlySignal<SessionConfig>}
    >
      {children}
    </SessionConfigContext.Provider>
  );
}

export function useSessionConfig() {
  return useContextSafely(SessionConfigContext);
}
