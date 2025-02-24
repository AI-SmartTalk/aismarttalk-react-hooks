import { useState, useEffect } from 'react';

/**
 * Represents a canvas with a title and content lines.
 */
export interface Canvas {
  /** The title of the canvas */
  title: string;
  /** Array of content lines in the canvas */
  content: string[];
}

/**
 * Hook to manage canvas history with persistent storage.
 * @param chatModelId - Unique identifier for the chat model
 * @returns Object containing canvas state and management functions
 */
export default function useCanvasHistory(chatModelId: string) {
  const storageKey = `canvasHistory:${chatModelId}`;

  // State to store the active canvas and its history.
  const [canvas, setCanvas] = useState<Canvas>({ title: '', content: [] });
  const [history, setHistory] = useState<Canvas[]>([]);

  // Load canvas history from local storage on initialization.
  useEffect(() => {
    const storedHistory = localStorage.getItem(storageKey);
    if (storedHistory) {
      try {
        const parsedHistory: Canvas[] = JSON.parse(storedHistory);
        setHistory(parsedHistory);
        // Set the first canvas from history as the active one.
        if (parsedHistory.length > 0) {
          setCanvas(parsedHistory[0]);
        }
      } catch (err) {
        console.error('Error parsing stored canvas history:', err);
      }
    } else {
      // No history found: initialize with a default canvas.
      const defaultCanvas: Canvas = { title: 'Untitled', content: [''] };
      setCanvas(defaultCanvas);
      setHistory([defaultCanvas]);
      localStorage.setItem(storageKey, JSON.stringify([defaultCanvas]));
    }
  }, [chatModelId, storageKey]);

  // Helper function to persist the history to local storage.
  const persistHistory = (newHistory: Canvas[]) => {
    localStorage.setItem(storageKey, JSON.stringify(newHistory));
  };

  /**
   * Updates the entire canvas with new content.
   * @param newCanvas - The new canvas to replace the current one
   */
  const updateCanvas = (newCanvas: Canvas): void => {
    setCanvas(newCanvas);
    const newHistory = [newCanvas, ...history];
    setHistory(newHistory);
    persistHistory(newHistory);
  };

  /**
   * Updates a specific range of lines within the canvas.
   * @param start - Starting line index (inclusive)
   * @param end - Ending line index (inclusive)
   * @param newLines - Array of new lines to insert
   * @throws {Error} If indices are out of bounds
   */
  const updateLineRange = (start: number, end: number, newLines: string[]): void => {
    if (start < 0 || end < start) {
      throw new Error('Invalid line range specified');
    }

    setCanvas(prev => {
      if (end >= prev.content.length) {
        throw new Error('Line range exceeds canvas content length');
      }

      const newContent = [...prev.content];
      newLines.forEach((line, index) => {
        const targetIndex = start + index;
        if (targetIndex <= end) {
          newContent[targetIndex] = line;
        }
      });

      const updatedCanvas = { ...prev, content: newContent };
      const newHistory = [updatedCanvas, ...history];
      setHistory(newHistory);
      persistHistory(newHistory);
      return updatedCanvas;
    });
  };

  /**
   * Inserts a new line at the specified index.
   * @param lineIndex - Index where the new line should be inserted
   * @param text - Content of the new line
   * @throws {Error} If index is out of bounds
   */
  const insertAtLine = (lineIndex: number, text: string): void => {
    if (lineIndex < 0) {
      throw new Error('Line index cannot be negative');
    }

    setCanvas(prev => {
      if (lineIndex > prev.content.length) {
        throw new Error('Line index exceeds canvas content length');
      }

      const newContent = [...prev.content];
      newContent.splice(lineIndex, 0, text);
      const updatedCanvas = { ...prev, content: newContent };
      const newHistory = [updatedCanvas, ...history];
      setHistory(newHistory);
      persistHistory(newHistory);
      return updatedCanvas;
    });
  };

  /**
   * Deletes a range of lines from the canvas.
   * @param start - Starting line index (inclusive)
   * @param end - Ending line index (inclusive)
   * @throws {Error} If indices are out of bounds
   */
  const deleteLineRange = (start: number, end: number): void => {
    if (start < 0 || end < start) {
      throw new Error('Invalid line range specified');
    }

    setCanvas(prev => {
      if (end >= prev.content.length) {
        throw new Error('Line range exceeds canvas content length');
      }

      const newContent = prev.content.filter((_, index) => index < start || index > end);
      const updatedCanvas = { ...prev, content: newContent };
      const newHistory = [updatedCanvas, ...history];
      setHistory(newHistory);
      persistHistory(newHistory);
      return updatedCanvas;
    });
  };

  /**
   * Switches to a different canvas from history.
   * @param canvasIndex - Index of the canvas in history to switch to
   * @throws {Error} If index is out of bounds
   */
  const switchActiveCanvas = (canvasIndex: number): void => {
    if (canvasIndex < 0 || canvasIndex >= history.length) {
      throw new Error('Canvas index out of bounds');
    }
    setCanvas(history[canvasIndex]);
  };

  /**
   * Converts the current canvas content to a string with line breaks.
   * @returns The canvas content as a single string
   */
  const toString = (): string => {
    return canvas.content.join('\n');
  };

  /**
   * Gets the canvas content with line numbers.
   * @param startLine - Optional starting line number (defaults to 1)
   * @returns Array of strings with format "lineNumber: content"
   */
  const getNumberedLines = (startLine: number = 1): string[] => {
    const maxLineNumberWidth = String(canvas.content.length + startLine - 1).length;
    return canvas.content.map((line, index) => {
      const lineNumber = startLine + index;
      const paddedLineNumber = String(lineNumber).padStart(maxLineNumberWidth, ' ');
      return `${paddedLineNumber}: ${line}`;
    });
  };

  return {
    canvas,
    history,
    updateCanvas,
    updateLineRange,
    insertAtLine,
    deleteLineRange,
    switchActiveCanvas,
    toString,
    getNumberedLines,
  };
}
