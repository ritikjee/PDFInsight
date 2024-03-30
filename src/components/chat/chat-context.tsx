import React, { createContext, useRef, useState } from "react";
import { useToast } from "../ui/use-toast";
import { useMutation } from "@tanstack/react-query";
import { trpc } from "@/app/_trpc/client";

type ChatContextType = {
  addMessage: () => void;
  message: string;
  handleInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  isLoading: boolean;
};

export const ChatContext = createContext<ChatContextType>({
  addMessage: () => {},
  message: "",
  handleInputChange: () => {},
  isLoading: false,
});

interface Props {
  children: React.ReactNode;
  fileId: string;
}

export const ChatProvider = ({ children, fileId }: Props) => {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const backupRef = useRef("");

  const utils = trpc.useContext();

  const { toast } = useToast();

  const { mutate: sendMessage } = useMutation({
    mutationFn: async ({ message }: { message: string }) => {
      const response = await fetch("/api/message", {
        method: "POST",
        body: JSON.stringify({
          fileId,
          message,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      return response.body;
    },
    onMutate: async ({ message }) => {
      backupRef.current = message;
      setMessage("");

      await utils.getFileMessages.cancel();

      const previousData = utils.getFileMessages.getInfiniteData();

      utils.getFileMessages.setInfiniteData(
        {
          fileId,
          limit: 10,
        },
        (old) => {
          if (!old) {
            return {
              pages: [],
              pageParams: [],
            };
          }
          let newPages = { ...old?.pages };
          let latestPage = newPages[0];

          latestPage.messages = [
            {
              createdAt: new Date().toISOString(),
              id: crypto.randomUUID(),
              text: message,
              isUserMessage: true,
            },
            ...latestPage.messages,
          ];

          newPages[0] = latestPage;

          return {
            ...old,
            pages: newPages,
          };
        }
      );

      setLoading(true);

      return {
        previousData:
          previousData?.pages.flatMap((page) => page.messages) ?? undefined,
      };
    },
    onSuccess: async (stream) => {
      setLoading(false);
      if (!stream) {
        return toast({
          title: "Something went wrong",
          description: "Please refresh the page and try again",
          variant: "destructive",
        });
      }

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let done = false;

      // accumulated response
      let accResponse = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value);

        accResponse += chunkValue;
        utils.getFileMessages.setInfiniteData({ fileId, limit: 10 }, (old) => {
          if (!old) return { pages: [], pageParams: [] };

          let isAiResponseCreated = old.pages.some((page) =>
            page.messages.some((message) => message.id === "ai-response")
          );
          let updatedPages = old.pages.map((page) => {
            if (page === old.pages[0]) {
              let updatedMessages;
              if (!isAiResponseCreated) {
                updatedMessages = [
                  {
                    createdAt: new Date().toISOString(),
                    id: "ai-response",
                    text: accResponse,
                    isUserMessage: false,
                  },
                  ...page.messages,
                ];
              } else {
                updatedMessages = page.messages.map((message) => {
                  if (message.id === "ai-response") {
                    return {
                      ...message,
                      text: accResponse,
                    };
                  }

                  return message;
                });
              }

              return {
                ...page,
                messages: updatedMessages,
              };
            }

            return page;
          });

          return {
            ...old,
            pages: updatedPages,
          };
        });
      }
    },
    onError: (_, __, context) => {
      setMessage(backupRef.current);
      utils.getFileMessages.setData(
        { fileId },
        {
          messages: context?.previousData ?? [],
        }
      );
    },
    onSettled: async () => {
      setLoading(false);

      await utils.getFileMessages.invalidate({
        fileId,
      });
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  };

  const addMessage = () => sendMessage({ message });

  return (
    <ChatContext.Provider
      value={{
        message,
        handleInputChange,
        addMessage,
        isLoading: loading,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
