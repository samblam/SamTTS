import React, { useEffect, useState, useCallback, useRef } from 'react';
import tmi from 'tmi.js';
import './TwitchChat.css';

const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const DEFAULT_RATE = 1.0; // Default speech rate
const MAX_RETRY_DELAY = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 5;

const TwitchChat = () => {
  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [client, setClient] = useState(null);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [speechRate, setSpeechRate] = useState(DEFAULT_RATE);
  const [isTTSEnabled, setIsTTSEnabled] = useState(true);
  const [filteredWords, setFilteredWords] = useState([]);
  const [messageQueue, setMessageQueue] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const speechSynthesis = useRef(window.speechSynthesis);
  const processQueueRef = useRef(null);

  // Initialize TTS and load available voices
  useEffect(() => {
    console.log('Initializing TTS system');
    
    const loadVoices = () => {
      const availableVoices = speechSynthesis.current.getVoices();
      console.log('Available voices:', availableVoices.map(v => ({
        name: v.name,
        lang: v.lang,
        default: v.default
      })));
      
      setVoices(availableVoices);
      
      // Set default voice (prefer English)
      const defaultVoice = availableVoices.find(voice => voice.lang.startsWith('en-')) || availableVoices[0];
      console.log('Selected default voice:', defaultVoice?.name);
      setSelectedVoice(defaultVoice);
    };

    // Chrome loads voices asynchronously
    if (speechSynthesis.current.onvoiceschanged !== undefined) {
      speechSynthesis.current.onvoiceschanged = loadVoices;
    }
    loadVoices();

    return () => {
      console.log('TTS cleanup: cancelling speech and clearing queue');
      speechSynthesis.current.cancel(); // Cancel any ongoing speech
      setMessageQueue([]); // Clear the queue
      setIsProcessing(false); // Reset processing state
    };
  }, []);

  // Function to add text to speech queue
  const speak = useCallback((text) => {
    console.log('Speak called:', {
      text,
      isTTSEnabled,
      hasVoice: !!selectedVoice,
      voiceName: selectedVoice?.name
    });

    if (!isTTSEnabled) {
      console.log('TTS is disabled, ignoring message');
      return;
    }
    
    if (!selectedVoice) {
      console.log('No voice selected, ignoring message');
      return;
    }
    
    setMessageQueue(prevQueue => {
      const newQueue = Array.isArray(prevQueue) ? [...prevQueue, text] : [text];
      console.log('Queue updated:', {
        addedMessage: text,
        previousLength: prevQueue.length,
        newLength: newQueue.length,
        fullQueue: newQueue
      });
      return newQueue;
    });
  }, [isTTSEnabled, selectedVoice]);

  const connect = useCallback(async () => {
    try {
      if (client) {
        await client.disconnect();
      }

      console.log('Initializing new TMI client');
      const newClient = new tmi.Client({
        connection: {
          reconnect: true,
          secure: true
        },
        channels: ['SamBarefoot'],
        logger: {
          info: (message) => console.log('[TMI info]', message),
          warn: (message) => console.warn('[TMI warn]', message),
          error: (message) => console.error('[TMI error]', message)
        }
      });

      setConnectionStatus('connecting');
      console.log('Attempting to connect to Twitch...');
      await newClient.connect().catch(err => {
        console.error('[TMI connect error]', {
          name: err.name,
          message: err.message,
          stack: err.stack
        });
        throw err;
      });
      
      setClient(newClient);
      setConnectionStatus('connected');
      setError(null);
      setRetryCount(0);
      
      console.log('Connected to Twitch chat');
    } catch (err) {
      console.error('Connection error:', {
        error: err,
        message: err.message,
        stack: err.stack,
        details: err.toString()
      });
      setError(`Connection failed: ${err.message}`);
      setConnectionStatus('disconnected');
      
      // Implement exponential backoff for retries
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, retryCount), MAX_RETRY_DELAY);
        console.log(`Retrying in ${delay/1000} seconds... (Attempt ${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`);
        
        setTimeout(() => {
          setRetryCount(prev => prev + 1);
          connect();
        }, delay);
      } else {
        setError('Maximum retry attempts reached. Please try again later.');
      }
    }
  }, [client, retryCount]);

  useEffect(() => {
    connect();

    return () => {
      if (client) {
        client.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (!client) return;

    const handleMessage = (channel, tags, message, self) => {

      const filterMessage = (msg) => { // Renamed parameter to avoid shadowing
        let processedMsg = msg;
        // Filter words
        filteredWords.forEach(word => {
          const regex = new RegExp(`\\b${word}\\b`, 'gi');
          processedMsg = processedMsg.replace(regex, '***'); // Replace with asterisks
        });

        // Basic link detection and replacement
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        processedMsg = processedMsg.replace(urlRegex, '[link removed]');

        return processedMsg.trim(); // Trim whitespace potentially left after filtering
      };

      const filteredMessageContent = filterMessage(message); // Filter the incoming message

      // Create the message object for display using the filtered content
      const displayMessage = {
        id: tags.id || Date.now().toString(),
        username: tags.username,
        message: filteredMessageContent, // Use filtered content for display
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, displayMessage]); // Add the filtered message to the display state
      console.log(`${tags.username}: ${message}`); // Log the original message for debugging/history

      // Only speak if the message is not empty after filtering
      if (filteredMessageContent) {
        speak(`${tags.username} says: ${filteredMessageContent}`); // Speak the filtered content
      }
    };

    const handleDisconnect = (error) => {
      console.log('Disconnect event:', {
        error,
        errorType: typeof error,
        errorDetails: error ? error.toString() : 'No error object',
        connectionState: client ? client.readyState() : 'No client',
        retryCount
      });
      
      setConnectionStatus('disconnected');
      setError(`Disconnected: ${error || 'Unknown error'}`);
      
      // Attempt to reconnect if not at max retries
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        console.log('Attempting reconnect...');
        connect();
      }
    };

    client.on('message', handleMessage);
    client.on('disconnected', handleDisconnect);

    return () => {
      client && client.removeListener('message', handleMessage);
      client && client.removeListener('disconnected', handleDisconnect);
    };
  }, [client, connect, retryCount, isTTSEnabled, speak]);

  // Initialize queue processor
  useEffect(() => {
    const processQueue = () => {
      // Get latest queue state
      const currentQueue = messageQueue;
      
      console.log('Queue processor check:', {
        isProcessing,
        currentQueue,
        queueLength: currentQueue?.length,
        selectedVoice: selectedVoice?.name,
        speechRate
      });

      if (isProcessing) {
        console.log('Already processing a message, skipping...');
        return;
      }

      if (!currentQueue || currentQueue.length === 0) {
        console.log('Queue is empty, nothing to process');
        return;
      }

      if (!selectedVoice) {
        console.log('No voice selected, cannot process queue');
        return;
      }

      const message = currentQueue[0];
      console.log('Processing message:', message, 'Full queue:', currentQueue);

      const utterance = new SpeechSynthesisUtterance(message);
      utterance.voice = selectedVoice;
      utterance.rate = speechRate;

      // Set up event handlers before starting speech
      utterance.onstart = () => {
        console.log('Speech started:', message);
        setIsProcessing(true);
      };

      utterance.onend = () => {
        console.log('Speech ended:', message);
        setIsProcessing(false);
        // Remove the processed message
        setMessageQueue(prevQueue => {
          const newQueue = prevQueue.slice(1);
          console.log('Message completed, new queue:', newQueue);
          return newQueue;
        });
        // Process next message if queue not empty
        setTimeout(() => {
          console.log('Checking for next message...');
          if (processQueueRef.current) {
            processQueueRef.current();
          }
        }, 100);
      };

      utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        console.log('Error details:', {
          message,
          voice: selectedVoice.name,
          rate: speechRate
        });
        setIsProcessing(false);
        setMessageQueue(prevQueue => {
          const newQueue = prevQueue.slice(1);
          console.log('Error occurred, new queue:', newQueue);
          return newQueue;
        });
        setTimeout(() => {
          if (processQueueRef.current) {
            processQueueRef.current();
          }
        }, 100);
      };

      // Start speaking
      try {
        console.log('Pre-speech check:', {
          synthAvailable: !!speechSynthesis.current,
          speaking: speechSynthesis.current?.speaking,
          pending: speechSynthesis.current?.pending,
          paused: speechSynthesis.current?.paused
        });

        if (!speechSynthesis.current) {
          throw new Error('Speech synthesis not available');
        }

        // Resume if paused
        if (speechSynthesis.current.paused) {
          console.log('Resuming paused speech synthesis');
          speechSynthesis.current.resume();
        }

        // Cancel any ongoing speech to prevent queue from getting stuck
        speechSynthesis.current.cancel();

        console.log('Attempting to speak:', message);
        speechSynthesis.current.speak(utterance);
      } catch (error) {
        console.error('Failed to start speech:', error);
        setIsProcessing(false);
        setMessageQueue(prevQueue => {
          const newQueue = prevQueue.slice(1);
          console.log('Speech failed, new queue:', newQueue);
          return newQueue;
        });
        setTimeout(() => {
          if (processQueueRef.current) {
            processQueueRef.current();
          }
        }, 100);
      }
    };

    processQueueRef.current = processQueue;

    return () => {
      console.log('Cleaning up queue processor');
      processQueueRef.current = null;
    };
  }, [messageQueue, selectedVoice, speechRate, isProcessing]); // Include all required dependencies

  // Watch queue and trigger processing
  useEffect(() => {
    const queueState = {
      queueLength: messageQueue?.length || 0,
      isProcessing,
      hasProcessor: !!processQueueRef.current,
      messages: messageQueue
    };
    
    console.log('Queue state changed:', queueState);

    // Only process if we have messages, aren't currently processing, and have a processor
    if (queueState.queueLength > 0 && !queueState.isProcessing && queueState.hasProcessor) {
      console.log('Conditions met for processing:', {
        nextMessage: queueState.messages[0],
        remainingMessages: queueState.messages.slice(1)
      });
      processQueueRef.current();
    } else {
      console.log('Skipping queue processing because:', {
        hasMessages: queueState.queueLength > 0,
        notProcessing: !queueState.isProcessing,
        hasProcessor: queueState.hasProcessor
      });
    }
  }, [messageQueue, isProcessing]); // Watch full messageQueue object, not just length

  const reconnect = () => {
    setRetryCount(0);
    setError(null);
    connect();
  };

  return (
    <div className="twitch-chat">
      <div className="status-bar">
        <span className={`status-indicator ${connectionStatus}`}>
          {connectionStatus}
        </span>
        <div className="tts-controls">
          <label>
            <input
              type="checkbox"
              checked={isTTSEnabled}
              onChange={(e) => setIsTTSEnabled(e.target.checked)}
            />
            TTS Enabled
          </label>
          <select
            value={selectedVoice ? selectedVoice.name : ''}
            onChange={(e) => {
              const voice = voices.find(v => v.name === e.target.value);
              setSelectedVoice(voice);
            }}
          >
            {voices.map(voice => (
              <option key={voice.name} value={voice.name}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
          <label>
            Rate:
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={speechRate}
              onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
            />
            {speechRate.toFixed(1)}x
          </label>
        </div>

        <div className="moderation-controls">
          <h3>Moderation</h3>
          <label>
            Filtered Words:
            <input
              type="text"
              id="newFilteredWord"
            />
            <button
              onClick={() => {
                const newWord = document.getElementById('newFilteredWord').value;
                if (newWord && !filteredWords.includes(newWord)) {
                  setFilteredWords([...filteredWords, newWord]);
                  document.getElementById('newFilteredWord').value = '';
                }
              }}
            >
              Add Word
            </button>
          </label>
          <ul>
            {filteredWords.map((word, index) => (
              <li key={index}>
                {word}
                <button
                  onClick={() => {
                    const newFilteredWords = [...filteredWords];
                    newFilteredWords.splice(index, 1);
                    setFilteredWords(newFilteredWords);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div> {/* Close moderation-controls */}

        {error && (
          <div className="error-container">
            <span className="error-message">{error}</span>
            {retryCount >= MAX_RETRY_ATTEMPTS && (
              <button onClick={reconnect} className="retry-button">
                Try Again
              </button>
            )}
          </div>
        )}
      </div> {/* Close status-bar */}
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className="message">
            <span className="timestamp">
              {msg.timestamp.toLocaleTimeString()}
            </span>
            <span className="username">{msg.username}:</span>
            <span className="content">{msg.message}</span>
          </div>
        ))}
      </div>
      <div className="queue">
        <h3>Message Queue</h3>
        <ul>
          {messageQueue && messageQueue.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default TwitchChat;