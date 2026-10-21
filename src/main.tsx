import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { Editor } from './ui/Editor';
import { Help, Home } from './ui/Home';
import { PlayRoute } from './ui/Player';
import { Spike } from './ui/Spike';

function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

function App() {
  const path = useRoute();
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'g' && parts[1]) return <PlayRoute key={parts[1]} gameId={parts[1]} />;
  if (parts[0] === 'e' && parts[1]) return <Editor key={parts[1]} remoteId={parts[1]} />;
  if (parts[0] === 'edit') return <Editor key="draft" />;
  if (parts[0] === 'help') return <Help />;
  if (parts[0] === 'spike') return <Spike />;
  return <Home />;
}

render(<App />, document.getElementById('app')!);
