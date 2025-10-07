import { useState, useEffect, useCallback, useRef } from "react";
import { CanvasFullContent, LineUpdate, CanvasLiveUpdate } from "../fileUpload/useFileUpload";

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
 * Extended canvas interface matching the API structure
 */
export interface ExtendedCanvas extends CanvasFullContent {
  /** Array of content lines derived from content string */
  contentLines: string[];
}

/**
 * Hook to manage multiple canvases with persistent storage and live updates.
 * @param chatModelId - Unique identifier for the chat model
 * @param chatInstanceId - Unique identifier for the chat instance
 * @returns Object containing canvas state and management functions
 */
export default function useCanvasHistory(chatModelId: string, chatInstanceId: string) {
  const storageKey = `canvasHistory:${chatModelId}:${chatInstanceId}`;

  // Multiple canvases state
  const [canvases, setCanvases] = useState<ExtendedCanvas[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  
  // Legacy single canvas interface for backward compatibility
  const [canvas, setCanvas] = useState<Canvas>({ title: "", content: [] });
  const [history, setHistory] = useState<Canvas[]>([]);
  
  // Use refs to track initialization to prevent loops
  const isInitializedRef = useRef<boolean>(false);
  const storageLoadedRef = useRef<boolean>(false);

  // Helper function to convert CanvasFullContent to ExtendedCanvas
  const toExtendedCanvas = useCallback((canvasData: CanvasFullContent): ExtendedCanvas => {
    return {
      ...canvasData,
      contentLines: canvasData.content ? canvasData.content.split('\n') : []
    };
  }, []);

  // Helper function to convert ExtendedCanvas to legacy Canvas format
  const toLegacyCanvas = useCallback((extendedCanvas: ExtendedCanvas): Canvas => {
    return {
      title: extendedCanvas.id,
      content: extendedCanvas.contentLines
    };
  }, []);

  // Load canvases from storage on initialization - ONLY RUN ONCE
  useEffect(() => {
    if (storageLoadedRef.current) return;
        
    const storedCanvases = localStorage.getItem(storageKey);
    if (storedCanvases) {
      try {
        const parsedCanvases: ExtendedCanvas[] = JSON.parse(storedCanvases);
        setCanvases(parsedCanvases);
        if (parsedCanvases.length > 0 && !activeCanvasId) {
          setActiveCanvasId(parsedCanvases[0].id);
        }
        storageLoadedRef.current = true;
      } catch (err) {
      }
    } else {
      storageLoadedRef.current = true;
    }
  }, [chatModelId, chatInstanceId, storageKey]); // Remove activeCanvasId dependency

  // Update legacy canvas state when active canvas changes - PREVENT INFINITE LOOP
  useEffect(() => {
    
    if (activeCanvasId && canvases.length > 0) {
      const activeCanvas = canvases.find(c => c.id === activeCanvasId);
      if (activeCanvas) {
        const legacyCanvas = toLegacyCanvas(activeCanvas);
        setCanvas(legacyCanvas);
        // DON'T update history here to prevent circular dependency
        setHistory(prev => {
          // Only update if the canvas actually changed
          if (prev.length === 0 || prev[0].title !== legacyCanvas.title) {
            return [legacyCanvas, ...prev.filter(h => h.title !== legacyCanvas.title)];
          }
          return prev;
        });
      } 
    } else if (canvases.length > 0 && !activeCanvasId) {
      // Default to first canvas if none selected
      const firstCanvas = canvases[0];
      setActiveCanvasId(firstCanvas.id);
    }
  }, [activeCanvasId, canvases, toLegacyCanvas]); // Remove history from dependencies to prevent loop

  const persistCanvases = useCallback((newCanvases: ExtendedCanvas[]) => {
    localStorage.setItem(storageKey, JSON.stringify(newCanvases));
  }, [storageKey]);

  /**
   * Set all canvases from API data
   */
  const setCanvasesFromAPI = useCallback((apiCanvases: CanvasFullContent[]) => {
    
    const extendedCanvases = apiCanvases.map(toExtendedCanvas);
    setCanvases(extendedCanvases);
    persistCanvases(extendedCanvases);
    
    // Only set active canvas if none is selected AND this is initial load
    if (extendedCanvases.length > 0 && !activeCanvasId && !isInitializedRef.current) {
      setActiveCanvasId(extendedCanvases[0].id);
      isInitializedRef.current = true;
    }
  }, [toExtendedCanvas, persistCanvases, activeCanvasId]);

  /**
   * Add a new canvas
   */
  const addCanvas = useCallback((newCanvas: CanvasFullContent) => {
    
    const extendedCanvas = toExtendedCanvas(newCanvas);
    setCanvases(prev => {
      const updated = [...prev, extendedCanvas];
      persistCanvases(updated);
      return updated;
    });
    
    // Set as active if first canvas
    if (canvases.length === 0) {
      setActiveCanvasId(newCanvas.id);
    }
  }, [toExtendedCanvas, persistCanvases, canvases.length]);

  /**
   * Update a specific canvas with live updates
   */
  const applyCanvasLiveUpdate = useCallback((update: CanvasLiveUpdate) => {
    const { canvasId, updates } = update;
    
    setCanvases(prev => {
      const updated = prev.map(canvas => {
        if (canvas.id === canvasId) {
          let updatedContent = canvas.content;
          const lines = updatedContent.split('\n');
          
          // Sort updates by line number in descending order to avoid index shifting issues
          const sortedUpdates = [...updates].sort((a, b) => b.lineNumber - a.lineNumber);
          
          sortedUpdates.forEach(lineUpdate => {
            const { lineNumber, oldContent, newContent } = lineUpdate;
            
            // Handle both 0-based and 1-based line numbers
            const zeroBasedLineNumber = lineNumber;
            const oneBasedLineNumber = lineNumber - 1;
            
            // Try to find the content at the expected line number
            let targetLineIndex = -1;
            let foundMatch = false;
            
            // First, try exact match at the specified line number (0-based)
            if (zeroBasedLineNumber >= 0 && zeroBasedLineNumber < lines.length) {
              if (lines[zeroBasedLineNumber] === oldContent || !oldContent) {
                targetLineIndex = zeroBasedLineNumber;
                foundMatch = true;
              }
            }
            
            // If not found, try 1-based line number
            if (!foundMatch && oneBasedLineNumber >= 0 && oneBasedLineNumber < lines.length) {
              if (lines[oneBasedLineNumber] === oldContent || !oldContent) {
                targetLineIndex = oneBasedLineNumber;
                foundMatch = true;
              }
            }
            
            // If exact match failed, try fuzzy matching around the expected line
            if (!foundMatch && oldContent) {
              const searchRange = 5; // Search within 5 lines of the expected position
              const startSearch = Math.max(0, Math.min(zeroBasedLineNumber, oneBasedLineNumber) - searchRange);
              const endSearch = Math.min(lines.length - 1, Math.max(zeroBasedLineNumber, oneBasedLineNumber) + searchRange);
              
              for (let i = startSearch; i <= endSearch; i++) {
                // Try exact match first
                if (lines[i] === oldContent) {
                  targetLineIndex = i;
                  foundMatch = true;
                  break;
                }
                
                // Try trimmed match (remove extra whitespace)
                if (lines[i].trim() === oldContent.trim()) {
                  targetLineIndex = i;
                  foundMatch = true;
                  break;
                }
                
                // Try partial match (check if old content is contained in the line)
                if (oldContent.length > 10 && lines[i].includes(oldContent.trim())) {
                  targetLineIndex = i;
                  foundMatch = true;
                  break;
                }
              }
            }
            
            // Apply the update
            if (foundMatch && targetLineIndex !== -1) {
              lines[targetLineIndex] = newContent;
            } else if (zeroBasedLineNumber === lines.length) {
              // Append new line at the end
              lines.push(newContent);
            } else {
              // Fallback: try to replace at the original line number anyway
              const fallbackIndex = Math.min(zeroBasedLineNumber, lines.length - 1);
              if (fallbackIndex >= 0) {
                lines[fallbackIndex] = newContent;
              } else {
              }
            }
          });
          
          const updatedCanvasContent = lines.join('\n');
          
          return {
            ...canvas,
            content: updatedCanvasContent,
            contentLines: lines
          };
        }
        return canvas;
      });
      
      persistCanvases(updated);
      return updated;
    });
  }, [persistCanvases]);

  /**
   * Get a specific canvas by ID
   */
  const getCanvasById = useCallback((canvasId: string): ExtendedCanvas | undefined => {
    return canvases.find(c => c.id === canvasId);
  }, [canvases]);

  /**
   * Switch to a different active canvas
   */
  const switchActiveCanvas = useCallback((canvasId: string) => {
    if (canvases.find(c => c.id === canvasId)) {
      setActiveCanvasId(canvasId);
    } else {
      throw new Error("Canvas not found");
    }
  }, [canvases]);

  // Legacy methods for backward compatibility - STABLE CALLBACKS
  const updateCanvas = useCallback((newCanvas: Canvas): void => {
    
    if (activeCanvasId) {
      setCanvases(prev => {
        const updated = prev.map(canvas => {
          if (canvas.id === activeCanvasId) {
            return {
              ...canvas,
              content: newCanvas.content.join('\n'),
              contentLines: newCanvas.content
            };
          }
          return canvas;
        });
        persistCanvases(updated);
        return updated;
      });
    }
    
    setCanvas(newCanvas);
    // Don't update history here to prevent circular dependency
  }, [activeCanvasId, persistCanvases]);

  const updateLineRange = useCallback((
    start: number,
    end: number,
    newLines: string[]
  ): void => {
    
    if (start < 0 || end < start) {
      throw new Error("Invalid line range specified");
    }

    if (!activeCanvasId) return;

    setCanvases(prev => {
      const updated = prev.map(canvas => {
        if (canvas.id === activeCanvasId) {
          if (end >= canvas.contentLines.length) {
            throw new Error("Line range exceeds canvas content length");
          }

          const newContentLines = [...canvas.contentLines];
          newLines.forEach((line, index) => {
            const targetIndex = start + index;
            if (targetIndex <= end) {
              newContentLines[targetIndex] = line;
            }
          });

          return {
            ...canvas,
            content: newContentLines.join('\n'),
            contentLines: newContentLines
          };
        }
        return canvas;
      });
      
      persistCanvases(updated);
      return updated;
    });

    // Update legacy state
    setCanvas(prev => {
      if (end >= prev.content.length) {
        throw new Error("Line range exceeds canvas content length");
      }

      const newContent = [...prev.content];
      newLines.forEach((line, index) => {
        const targetIndex = start + index;
        if (targetIndex <= end) {
          newContent[targetIndex] = line;
        }
      });

      return { ...prev, content: newContent };
    });
  }, [activeCanvasId, persistCanvases]);

  const insertAtLine = useCallback((lineIndex: number, text: string): void => {
    
    if (lineIndex < 0) {
      throw new Error("Line index cannot be negative");
    }

    if (!activeCanvasId) return;

    setCanvases(prev => {
      const updated = prev.map(canvas => {
        if (canvas.id === activeCanvasId) {
          if (lineIndex > canvas.contentLines.length) {
            throw new Error("Line index exceeds canvas content length");
          }

          const newContentLines = [...canvas.contentLines];
          newContentLines.splice(lineIndex, 0, text);

          return {
            ...canvas,
            content: newContentLines.join('\n'),
            contentLines: newContentLines
          };
        }
        return canvas;
      });
      
      persistCanvases(updated);
      return updated;
    });

    // Update legacy state
    setCanvas(prev => {
      if (lineIndex > prev.content.length) {
        throw new Error("Line index exceeds canvas content length");
      }

      const newContent = [...prev.content];
      newContent.splice(lineIndex, 0, text);
      return { ...prev, content: newContent };
    });
  }, [activeCanvasId, persistCanvases]);

  const deleteLineRange = useCallback((start: number, end: number): void => {
    
    if (start < 0 || end < start) {
      throw new Error("Invalid line range specified");
    }

    if (!activeCanvasId) return;

    setCanvases(prev => {
      const updated = prev.map(canvas => {
        if (canvas.id === activeCanvasId) {
          if (end >= canvas.contentLines.length) {
            throw new Error("Line range exceeds canvas content length");
          }

          const newContentLines = canvas.contentLines.filter(
            (_, index) => index < start || index > end
          );

          return {
            ...canvas,
            content: newContentLines.join('\n'),
            contentLines: newContentLines
          };
        }
        return canvas;
      });
      
      persistCanvases(updated);
      return updated;
    });

    // Update legacy state
    setCanvas(prev => {
      if (end >= prev.content.length) {
        throw new Error("Line range exceeds canvas content length");
      }

      const newContent = prev.content.filter(
        (_, index) => index < start || index > end
      );
      return { ...prev, content: newContent };
    });
  }, [activeCanvasId, persistCanvases]);

  const toString = useCallback((): string => {
    return canvas.content.join("\n\n");
  }, [canvas.content]);

  const getNumberedLines = useCallback((startLine: number = 1): string[] => {
    const maxLineNumberWidth = String(
      canvas.content.length + startLine - 1
    ).length;
    return canvas.content.map((line, index) => {
      const lineNumber = startLine + index;
      const paddedLineNumber = String(lineNumber).padStart(
        maxLineNumberWidth,
        " "
      );
      return `${paddedLineNumber}: ${line}`;
    });
  }, [canvas.content]);


  return {
    // New multi-canvas interface
    canvases,
    activeCanvasId,
    setCanvasesFromAPI,
    addCanvas,
    applyCanvasLiveUpdate,
    getCanvasById,
    switchActiveCanvas,
    
    // Legacy single canvas interface (for backward compatibility)
    canvas,
    history,
    updateCanvas,
    updateLineRange,
    insertAtLine,
    deleteLineRange,
    toString,
    getNumberedLines,
  };
}
