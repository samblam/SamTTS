import React from 'react';
import './App.css';
import TwitchChat from './components/TwitchChat';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>SamTTS - Twitch Chat Reader</h1>
      </header>
      <main>
        <TwitchChat />
      </main>
    </div>
  );
}

export default App;
