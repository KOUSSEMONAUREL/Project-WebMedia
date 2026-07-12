import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';

interface LiveTVPlayerProps {
  streamUrl: string;
  channelName: string;
  channelLogo?: string;
  onBack?: () => void;
}

export function LiveTVPlayer({ streamUrl, channelName, channelLogo, onBack }: LiveTVPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const destroy = useCallback(() => {
    if (plyrRef.current) {
      plyrRef.current.destroy();
      plyrRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    setStatus('loading');
    setErrorMsg('');

    const setupPlyr = () => {
      if (plyrRef.current) return;
      plyrRef.current = new Plyr(video, {
        controls: [
          'play-large', 'play', 'progress', 'current-time',
          'mute', 'volume', 'settings', 'fullscreen',
        ],
        settings: ['quality'],
        muted: true,
      });
    };

    const onError = (msg: string) => {
      setStatus('error');
      setErrorMsg(msg);
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        fragLoadingMaxRetry: 3,
        manifestLoadingMaxRetry: 3,
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus('ready');
        setupPlyr();
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          onError(`Erreur de lecture: ${data.type}`);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setStatus('ready');
        setupPlyr();
        video.play().catch(() => {});
      });
      video.addEventListener('error', () => {
        onError('Impossible de lire ce flux');
      });
    } else {
      onError('HLS nest pas supporte par votre navigateur');
    }

    return () => {
      destroy();
    };
  }, [streamUrl, destroy]);

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-card rounded-xl border border-border">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <p className="text-lg font-medium text-foreground mb-2">Erreur de lecture</p>
        <p className="text-sm text-muted-foreground mb-6">{errorMsg}</p>
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity">
            <ArrowLeft className="w-4 h-4" /> Retour aux chaines
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-3 mb-4">
        {onBack && (
          <button onClick={onBack} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        {channelLogo && (
          <img src={channelLogo} alt={channelName} className="w-8 h-8 object-contain rounded" />
        )}
        <h1 className="text-xl font-semibold">{channelName}</h1>
        {status === 'loading' && (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground ml-auto" />
        )}
      </div>

      <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full"
          playsInline
          crossOrigin="anonymous"
        />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Chargement du flux...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
