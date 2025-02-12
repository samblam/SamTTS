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
  const [messageQueue, setMessageQueue] = useState([]);
  const speechSynthesis = useRef(window.speechSynthesis);

  // Initialize TTS and load available voices
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = speechSynthesis.current.getVoices();
      setVoices(availableVoices);
      // Set default voice (prefer English)
      const defaultVoice = availableVoices.find(voice => voice.lang.startsWith('en-')) || availableVoices[0];
      setSelectedVoice(defaultVoice);
    };

    // Chrome loads voices asynchronously
    if (speechSynthesis.current.onvoiceschanged !== undefined) {
      speechSynthesis.current.onvoiceschanged = loadVoices;
    }
    loadVoices();

    return () => {
      speechSynthesis.current.cancel(); // Cancel any ongoing speech when unmounting
    };
  }, []);

  // Function to speak text
  const speak = useCallback((text) => {
    if (!isTTSEnabled || !selectedVoice) return;

    // Cancel any ongoing speech

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selectedVoice;
    utterance.rate = speechRate;
    setMessageQueue(prevQueue => [...prevQueue, text]);
  }, [selectedVoice, speechRate, isTTSEnabled, setMessageQueue]);

  const connect = useCallback(async () => {
    try {
      if (client) {
        await client.disconnect();
      }

      const newClient = new tmi.Client({
        connection: {
          reconnect: true,
          secure: true
        },
        channels: ['greenshoesandsam']
      });

      setConnectionStatus('connecting');
      await newClient.connect();
      
      setClient(newClient);
      setConnectionStatus('connected');
      setError(null);
      setRetryCount(0);
      
      console.log('Connected to Twitch chat');
    } catch (err) {
      console.error('Connection error:', err);
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
      const newMessage = {
        id: tags.id || Date.now().toString(),
        username: tags.username,
        message: message,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, newMessage]);
      console.log(`${tags.username}: ${message}`);
      
      speak(`${tags.username} says: ${message}`);
    };

    const handleDisconnect = (error) => {
      setConnectionStatus('disconnected');
      setError(`Disconnected: ${error || 'Unknown error'}`);
      
      // Attempt to reconnect if not at max retries
      if (retryCount < MAX_RETRY_ATTEMPTS) {
        connect();
      }
    };

    client.on('message', handleMessage);
    client.on('disconnected', handleDisconnect);

    return () => {
      client.removeListener('message', handleMessage);
      client.removeListener('disconnected', handleDisconnect);
    };
  }, [client, connect, retryCount, isTTSEnabled, speak]);

  // Process message queue
  useEffect(() => {
    const processQueue = () => {
      if (messageQueue.length > 0 && !speechSynthesis.current.speaking) {
        const message = messageQueue[0];
        setMessageQueue(prevQueue => prevQueue.shift());

        const utterance = new SpeechSynthesisUtterance(message);
        utterance.voice = selectedVoice;
        utterance.rate = speechRate;
        speechSynthesis.current.speak(utterance);

        utterance.onend = () => {
          setTimeout(processQueue, 1000); // 1-second pause
        };
      }
    };

    processQueue();
  }, [messageQueue, selectedVoice, speechRate]);

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
      </div>
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
          {messageQueue.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default TwitchChat;