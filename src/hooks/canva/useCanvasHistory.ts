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

  console.log(`[CANVAS_HISTORY] Hook called with chatModelId: ${chatModelId}, chatInstanceId: ${chatInstanceId}`);

  // Multiple canvases state
  const [canvases, setCanvases] = useState<ExtendedCanvas[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  
  // Canvas history state - track versions of each canvas
  const [canvasVersionHistory, setCanvasVersionHistory] = useState<Record<string, ExtendedCanvas[]>>({});
  
  // Legacy single canvas interface for backward compatibility
  const [canvas, setCanvas] = useState<Canvas>({ title: "", content: [] });
  const [history, setHistory] = useState<Canvas[]>([]);
  
  // Use refs to track initialization to prevent loops
  const isInitializedRef = useRef<boolean>(false);
  const storageLoadedRef = useRef<boolean>(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to convert CanvasFullContent to ExtendedCanvas
  const toExtendedCanvas = useCallback((canvasData: CanvasFullContent): ExtendedCanvas => {
    console.log(`[CANVAS_HISTORY] Converting to ExtendedCanvas:`, canvasData.id);
    return {
      ...canvasData,
      contentLines: canvasData.content ? canvasData.content.split('\n') : []
    };
  }, []);

  // Helper function to convert ExtendedCanvas to legacy Canvas format
  const toLegacyCanvas = useCallback((extendedCanvas: ExtendedCanvas): Canvas => {
    console.log(`[CANVAS_HISTORY] Converting to legacy Canvas:`, extendedCanvas.id);
    return {
      title: extendedCanvas.id,
      content: extendedCanvas.contentLines
    };
  }, []);

  // Load canvases from storage on initialization - ONLY RUN ONCE
  useEffect(() => {
    if (storageLoadedRef.current) return;
    
    console.log(`[CANVAS_HISTORY] Effect - Load from storage triggered. storageKey: ${storageKey}`);
    
    const storedCanvases = localStorage.getItem(storageKey);
    if (storedCanvases) {
      try {
        const parsedCanvases: ExtendedCanvas[] = JSON.parse(storedCanvases);
        console.log(`[CANVAS_HISTORY] Loaded ${parsedCanvases.length} canvases from storage`);
        setCanvases(parsedCanvases);
        if (parsedCanvases.length > 0 && !activeCanvasId) {
          console.log(`[CANVAS_HISTORY] Setting active canvas from storage:`, parsedCanvases[0].id);
          setActiveCanvasId(parsedCanvases[0].id);
        }
        storageLoadedRef.current = true;
      } catch (err) {
        console.error("[CANVAS_HISTORY] Error parsing stored canvases:", err);
      }
    } else {
      console.log(`[CANVAS_HISTORY] No stored canvases found for key: ${storageKey}`);
      storageLoadedRef.current = true;
    }
  }, [chatModelId, chatInstanceId, storageKey]); // Remove activeCanvasId dependency

  // Update legacy canvas state when active canvas changes - PREVENT INFINITE LOOP
  useEffect(() => {
    console.log(`[CANVAS_HISTORY] Effect - Update legacy canvas triggered. activeCanvasId: ${activeCanvasId}, canvases.length: ${canvases.length}`);
    
    if (activeCanvasId && canvases.length > 0) {
      const activeCanvas = canvases.find(c => c.id === activeCanvasId);
      if (activeCanvas) {
        console.log(`[CANVAS_HISTORY] Found active canvas:`, activeCanvas.id);
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
      } else {
        console.log(`[CANVAS_HISTORY] Active canvas not found in canvases array`);
      }
    } else if (canvases.length > 0 && !activeCanvasId) {
      // Default to first canvas if none selected
      const firstCanvas = canvases[0];
      console.log(`[CANVAS_HISTORY] Setting default active canvas:`, firstCanvas.id);
      setActiveCanvasId(firstCanvas.id);
    }
  }, [activeCanvasId, canvases, toLegacyCanvas]); // Remove history from dependencies to prevent loop

  const persistCanvases = useCallback((newCanvases: ExtendedCanvas[]) => {
    console.log(`[CANVAS_HISTORY] Persisting ${newCanvases.length} canvases to storage`);
    localStorage.setItem(storageKey, JSON.stringify(newCanvases));
    
    // Also persist the canvas version history
    if (canvasVersionHistory && Object.keys(canvasVersionHistory).length > 0) {
      localStorage.setItem(`${storageKey}:versions`, JSON.stringify(canvasVersionHistory));
    }
  }, [storageKey, canvasVersionHistory]);

  /**
   * Save a version of a canvas to its history
   */
  const saveCanvasVersion = useCallback((canvas: ExtendedCanvas) => {
    console.log(`[CANVAS_HISTORY] Saving version for canvas: ${canvas.id}`, canvas);
    
    setCanvasVersionHistory(prev => {
      const canvasHistory = prev[canvas.id] || [];
      
      // Check if this version is different from the last saved version
      const lastVersion = canvasHistory[0];
      if (lastVersion && lastVersion.content === canvas.content) {
        console.log(`[CANVAS_HISTORY] Skipping duplicate version for canvas: ${canvas.id}`);
        return prev; // No change, don't save duplicate
      }
      
      // Keep only the last 10 versions to avoid memory issues
      const updatedHistory = [canvas, ...canvasHistory.slice(0, 9)];
      
      const newVersionHistory = {
        ...prev,
        [canvas.id]: updatedHistory
      };
      
      console.log(`[CANVAS_HISTORY] Saved new version for canvas ${canvas.id}. Total versions: ${updatedHistory.length}`);
      
      // Debounced save to localStorage to avoid too frequent writes
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      saveTimeoutRef.current = setTimeout(() => {
        console.log(`[CANVAS_HISTORY] Persisting version history to localStorage for ${Object.keys(newVersionHistory).length} canvases`);
        localStorage.setItem(`${storageKey}:versions`, JSON.stringify(newVersionHistory));
      }, 1000);
      
      return newVersionHistory;
    });
  }, [storageKey]);

  /**
   * Get version history for a specific canvas
   */
  const getCanvasVersionHistory = useCallback((canvasId: string): ExtendedCanvas[] => {
    const versions = canvasVersionHistory[canvasId] || [];
    console.log(`[CANVAS_HISTORY] getCanvasVersionHistory for ${canvasId}: ${versions.length} versions`);
    return versions;
  }, [canvasVersionHistory]);

  /**
   * Restore a specific version of a canvas
   */
  const restoreCanvasVersion = useCallback((canvasId: string, versionIndex: number) => {
    console.log(`[CANVAS_HISTORY] Restoring canvas ${canvasId} to version ${versionIndex}`);
    
    const versions = canvasVersionHistory[canvasId];
    if (!versions || versionIndex >= versions.length) {
      console.error(`[CANVAS_HISTORY] Version ${versionIndex} not found for canvas ${canvasId}`);
      return;
    }
    
    const versionToRestore = versions[versionIndex];
    
    // Update the current canvas with the restored version
    setCanvases(prev => {
      const updated = prev.map(canvas => 
        canvas.id === canvasId ? { 
          ...versionToRestore,
          // Add a lastRestored property to track when this was restored
          lastRestored: new Date().toISOString()
        } as ExtendedCanvas : canvas
      );
      persistCanvases(updated);
      return updated;
    });

    // Update the version history by removing all versions that came after the restored one
    setCanvasVersionHistory(prev => {
      const currentVersions = prev[canvasId] || [];
      
      // Keep only versions from the restored index onwards (removing newer versions)
      const updatedVersions = currentVersions.slice(versionIndex);
      
      // Update the first version (index 0) to be the restored version with current timestamp
      if (updatedVersions.length > 0) {
        updatedVersions[0] = {
          ...versionToRestore,
          // Store restore timestamp in a way that doesn't conflict with ExtendedCanvas
          lastRestored: new Date().toISOString()
        } as ExtendedCanvas;
      }
      
      const newVersionHistory = {
        ...prev,
        [canvasId]: updatedVersions
      };
      
      console.log(`[CANVAS_HISTORY] Updated version history for canvas ${canvasId}. Removed ${versionIndex} newer versions. Remaining: ${updatedVersions.length}`);
      
      // Persist to localStorage
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      saveTimeoutRef.current = setTimeout(() => {
        console.log(`[CANVAS_HISTORY] Persisting updated version history to localStorage`);
        localStorage.setItem(`${storageKey}:versions`, JSON.stringify(newVersionHistory));
      }, 1000);
      
      return newVersionHistory;
    });
  }, [canvasVersionHistory, persistCanvases, storageKey]);

  /**
   * Set all canvases from API data
   */
  const setCanvasesFromAPI = useCallback((apiCanvases: CanvasFullContent[]) => {
    console.log(`[CANVAS_HISTORY] setCanvasesFromAPI called with ${apiCanvases.length} canvases`);
    console.log(`[CANVAS_HISTORY] API Canvas IDs:`, apiCanvases.map(c => c.id));
    
    const extendedCanvases = apiCanvases.map(toExtendedCanvas);
    setCanvases(extendedCanvases);
    persistCanvases(extendedCanvases);
    
    // Save initial versions for each canvas
    extendedCanvases.forEach(canvas => {
      saveCanvasVersion(canvas);
    });
    
    // Only set active canvas if none is selected AND this is initial load
    if (extendedCanvases.length > 0 && !activeCanvasId && !isInitializedRef.current) {
      console.log(`[CANVAS_HISTORY] Setting active canvas from API:`, extendedCanvases[0].id);
      setActiveCanvasId(extendedCanvases[0].id);
      isInitializedRef.current = true;
    }
  }, [toExtendedCanvas, persistCanvases, activeCanvasId, saveCanvasVersion]);

  /**
   * Add a new canvas
   */
  const addCanvas = useCallback((newCanvas: CanvasFullContent) => {
    console.log(`[CANVAS_HISTORY] addCanvas called:`, newCanvas.id);
    
    const extendedCanvas = toExtendedCanvas(newCanvas);
    setCanvases(prev => {
      console.log(`[CANVAS_HISTORY] Adding canvas to existing ${prev.length} canvases`);
      const updated = [...prev, extendedCanvas];
      persistCanvases(updated);
      return updated;
    });
    
    // Save initial version
    saveCanvasVersion(extendedCanvas);
    
    // Set as active if first canvas
    if (canvases.length === 0) {
      console.log(`[CANVAS_HISTORY] Setting as active canvas (first canvas)`);
      setActiveCanvasId(newCanvas.id);
    }
  }, [toExtendedCanvas, persistCanvases, canvases.length, saveCanvasVersion]);

  /**
   * Update a specific canvas with live updates
   */
  const applyCanvasLiveUpdate = useCallback((update: CanvasLiveUpdate) => {
    const { canvasId, updates } = update;
    console.log(`[CANVAS_HISTORY] applyCanvasLiveUpdate called for canvas: ${canvasId}, updates: ${updates.length}`);
    
    setCanvases(prev => {
      const updated = prev.map(canvas => {
        if (canvas.id === canvasId) {
          console.log(`[CANVAS_HISTORY] Applying live updates to canvas: ${canvasId}`);
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
                console.warn(`Line content mismatch at line ${lineNumber}. Expected: "${oldContent}", Found: "${lines[fallbackIndex] || 'undefined'}". Applying update anyway.`);
                lines[fallbackIndex] = newContent;
              } else {
                console.error(`Cannot apply update for line ${lineNumber}: out of bounds and no fallback available`);
              }
            }
          });
          
          const updatedCanvasContent = lines.join('\n');
          
          const updatedCanvas = {
            ...canvas,
            content: updatedCanvasContent,
            contentLines: lines
          };
          
          // Save this version to history
          saveCanvasVersion(updatedCanvas);
          
          return updatedCanvas;
        }
        return canvas;
      });
      
      persistCanvases(updated);
      return updated;
    });
  }, [persistCanvases, saveCanvasVersion]);

  /**
   * Get a specific canvas by ID
   */
  const getCanvasById = useCallback((canvasId: string): ExtendedCanvas | undefined => {
    console.log(`[CANVAS_HISTORY] getCanvasById called:`, canvasId);
    return canvases.find(c => c.id === canvasId);
  }, [canvases]);

  /**
   * Switch to a different active canvas
   */
  const switchActiveCanvas = useCallback((canvasId: string) => {
    console.log(`[CANVAS_HISTORY] switchActiveCanvas called:`, canvasId);
    if (canvases.find(c => c.id === canvasId)) {
      setActiveCanvasId(canvasId);
    } else {
      console.error(`[CANVAS_HISTORY] Canvas not found:`, canvasId);
      throw new Error("Canvas not found");
    }
  }, [canvases]);

  // Legacy methods for backward compatibility - STABLE CALLBACKS
  const updateCanvas = useCallback((newCanvas: Canvas): void => {
    console.log(`[CANVAS_HISTORY] updateCanvas called (legacy):`, newCanvas.title);
    
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
    console.log(`[CANVAS_HISTORY] updateLineRange called: start=${start}, end=${end}, newLines=${newLines.length}`);
    
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
    console.log(`[CANVAS_HISTORY] insertAtLine called: lineIndex=${lineIndex}`);
    
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
    console.log(`[CANVAS_HISTORY] deleteLineRange called: start=${start}, end=${end}`);
    
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

  // Load canvas version history from storage on initialization
  useEffect(() => {
    if (!storageLoadedRef.current) return;
    
    console.log(`[CANVAS_HISTORY] Loading version history from storage with key: ${storageKey}:versions`);
    const storedVersionHistory = localStorage.getItem(`${storageKey}:versions`);
    if (storedVersionHistory) {
      try {
        const parsedVersionHistory: Record<string, ExtendedCanvas[]> = JSON.parse(storedVersionHistory);
        console.log(`[CANVAS_HISTORY] Loaded version history for ${Object.keys(parsedVersionHistory).length} canvases:`, Object.keys(parsedVersionHistory));
        setCanvasVersionHistory(parsedVersionHistory);
      } catch (err) {
        console.error("[CANVAS_HISTORY] Error parsing stored version history:", err);
      }
    } else {
      console.log(`[CANVAS_HISTORY] No stored version history found`);
    }
  }, [storageKey, storageLoadedRef.current]);

  // Cleanup effect
  useEffect(() => {
    return () => {
      // Save any pending canvas version history on unmount
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        if (canvasVersionHistory && Object.keys(canvasVersionHistory).length > 0) {
          localStorage.setItem(`${storageKey}:versions`, JSON.stringify(canvasVersionHistory));
        }
      }
    };
  }, [storageKey, canvasVersionHistory]);

  console.log(`[CANVAS_HISTORY] Hook render complete. canvases: ${canvases.length}, activeCanvasId: ${activeCanvasId}`);

  return {
    // New multi-canvas interface
    canvases,
    activeCanvasId,
    setCanvasesFromAPI,
    addCanvas,
    applyCanvasLiveUpdate,
    getCanvasById,
    switchActiveCanvas,
    
    // Canvas history management
    canvasVersionHistory,
    getCanvasVersionHistory,
    restoreCanvasVersion,
    saveCanvasVersion,
    
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
