import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Animated,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Modal,
  FlatList,
  KeyboardAvoidingView,
} from 'react-native';
import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
} from '@dev-amirzubair/react-native-voice';
import Tts from 'react-native-tts';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { initLlama } from 'llama.rn';

// Interfaces for TTS Engine voices
interface TTSVoice {
  id: string;
  name: string;
  language: string;
  quality?: number;
  latency?: number;
  notInstalled?: boolean;
}

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
}

interface ModelOption {
  id: string;
  name: string;
  url: string;
  filename: string;
  size: string;
  isCloud?: boolean;
}

// Available Models
const MODELS: ModelOption[] = [
  {
    id: 'llama-1b',
    name: 'llama3.2:1b',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    size: '1.2 GB',
  },
  {
    id: 'llama-3b',
    name: 'llama3.2:3b',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    size: '2.0 GB',
  },
  {
    id: 'qwen-cloud',
    name: 'qwen3.5:cloud',
    url: '',
    filename: '',
    size: '',
    isCloud: true,
  },
  {
    id: 'nemotron-cloud',
    name: 'nemotron-3-super:cloud',
    url: '',
    filename: '',
    size: '',
    isCloud: true,
  },
  {
    id: 'gemma-cloud',
    name: 'gemma4:31b-cloud',
    url: '',
    filename: '',
    size: '',
    isCloud: true,
  },
  {
    id: 'deepseek-cloud',
    name: 'deepseek-r1:8b',
    url: '',
    filename: '',
    size: '',
    isCloud: true,
  }
];

export default function App() {
  // --- TAB ROUTING ---
  const [currentTab, _setCurrentTab] = useState<string>('stt');
  const currentTabRef = useRef<string>('stt');
  const setCurrentTab = (tab: string) => {
    _setCurrentTab(tab);
    currentTabRef.current = tab;
  };

  // --- CONFIGURATION STATE ---
  const [sttLocale, setSttLocale] = useState<string>('en-US');
  const [speechRate, setSpeechRate] = useState<number>(0.5); // Default 0.5 is normal speed for Tts
  const [speechPitch, setSpeechPitch] = useState<number>(1.0); // 1.0 is default pitch
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [voiceListVisible, setVoiceListVisible] = useState<boolean>(false);

  // --- STT & TTS ACTIVE STATES ---
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [transcribedText, setTranscribedText] = useState<string>('');
  const [ttsInputText, setTtsInputText] = useState<string>(
    'Hello! This is a test of the on-device text to speech engine. Adjust my rate and pitch to customize my voice!'
  );

  // --- OFFLINE MODELS SELECTION STATE ---
  const [selectedModelId, setSelectedModelId] = useState<string>('llama-1b');
  const [downloadedModels, setDownloadedModels] = useState<{[key: string]: boolean}>({
    'llama-1b': false,
    'llama-3b': false
  });
  const [modelDropdownVisible, setModelDropdownVisible] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const selectedModel = MODELS.find(m => m.id === selectedModelId) || MODELS[0];
  const getModelPath = (filename: string) => `${RNFS.DocumentDirectoryPath}/${filename}`;

  // --- DOWNLOAD STATE ---
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadSpeed, setDownloadSpeed] = useState<string>('0 MB/s');
  const [downloadedSize, setDownloadedSize] = useState<string>('0 MB');
  const [totalSize, setTotalSize] = useState<string>('0 MB');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadJobId = useRef<number | null>(null);

  // --- LLAMA ENGINE STATE ---
  const llamaContextRef = useRef<any>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [llamaInitialized, setLlamaInitialized] = useState<boolean>(false);
  const [isLlamaInitializing, setIsLlamaInitializing] = useState<boolean>(false);

  // --- TEXT CHAT STATE ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: '1', text: 'Hello! I am your local offline AI Chat Bot. Ask me anything, and I will keep it short!', sender: 'ai' }
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const chatFlatListRef = useRef<FlatList>(null);

  // --- VOICE CHAT STATE ---
  const [voiceChatStatus, _setVoiceChatStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const voiceChatStatusRef = useRef<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const setVoiceChatStatus = (status: 'idle' | 'listening' | 'thinking' | 'speaking') => {
    _setVoiceChatStatus(status);
    voiceChatStatusRef.current = status;
  };
  const [voiceChatUserTranscript, setVoiceChatUserTranscript] = useState<string>('');
  const [voiceChatAiResponse, setVoiceChatAiResponse] = useState<string>('');
  const [voiceSettingsVisible, setVoiceSettingsVisible] = useState<boolean>(false);
  const voiceChatActiveRef = useRef<boolean>(false);

  // --- ERROR AND DIAGNOSTIC STATES ---
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [ttsInitialized, setTtsInitialized] = useState<boolean>(false);

  // --- PULSING ANIMATION REFERENCE ---
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const voicePulseAnim = useRef(new Animated.Value(1)).current;

  // --- STT ERROR MAPPING LOGIC ---
  const mapSTTError = (errorEvent: SpeechErrorEvent | any): string => {
    if (!errorEvent) return 'Unknown STT error.';
    const rawError = errorEvent.error?.message || errorEvent.message || String(errorEvent);
    console.log('[STT Raw Error]:', rawError);

    if (rawError.includes('1') || rawError.toLowerCase().includes('network_timeout')) {
      return 'Network timeout. Please ensure your device has internet connectivity.';
    }
    if (rawError.includes('2') || rawError.toLowerCase().includes('network')) {
      return 'Network communication error. Double check internet and DNS settings.';
    }
    if (rawError.includes('3') || rawError.toLowerCase().includes('audio')) {
      return 'Audio recording failed. Check if another app is utilizing the microphone.';
    }
    if (rawError.includes('4') || rawError.toLowerCase().includes('server')) {
      return 'Google Speech Recognition server error. Please try again later.';
    }
    if (rawError.includes('5') || rawError.toLowerCase().includes('client')) {
      return 'Speech Recognition client interface error.';
    }
    if (rawError.includes('6') || rawError.toLowerCase().includes('speech_timeout')) {
      return 'No speech detected. The microphone stopped listening. Please try again.';
    }
    if (rawError.includes('7') || rawError.toLowerCase().includes('no_match')) {
      return 'Speech could not be matched to a vocabulary. Speak clearly and closer to the microphone.';
    }
    if (rawError.includes('8') || rawError.toLowerCase().includes('busy')) {
      return 'Speech recognition service is currently busy. Try toggling the microphone again.';
    }
    if (rawError.includes('9') || rawError.toLowerCase().includes('permission')) {
      return 'Microphone access denied. Please allow RECORD_AUDIO permission in app settings.';
    }

    return `Recognition Error: ${rawError}`;
  };

  // --- PERMISSION HANDLER ---
  const checkMicrophonePermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const hasPermission = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        if (hasPermission) return true;

        const requestResult = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission Needed',
            message: 'AcousticLab requires microphone access to transcribe speech in real-time.',
            buttonNeutral: 'Ask Later',
            buttonNegative: 'Deny',
            buttonPositive: 'Grant Access',
          }
        );
        return requestResult === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        setDiagnosticError(`Permission Error: ${String(err)}`);
        return false;
      }
    }
    return true; // iOS
  };

  // --- INITIALIZE ENGINES AND ATTACH LIFECYCLE LISTENERS ---
  useEffect(() => {
    // Check if GGUF files exist on startup
    checkModelFiles();

    // 1. Initialize Speech-To-Text (Voice) listeners
    Voice.onSpeechStart = () => {
      if (currentTabRef.current === 'stt') {
        setIsListening(true);
      }
      setDiagnosticError(null);
    };

    Voice.onSpeechEnd = () => {
      if (currentTabRef.current === 'stt') {
        setIsListening(false);
      }
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      const parsedError = mapSTTError(e);
      setDiagnosticError(parsedError);

      if (currentTabRef.current === 'stt') {
        setIsListening(false);
      }
      if (currentTabRef.current === 'voiceChat') {
        setVoiceChatStatus('idle');
        voiceChatActiveRef.current = false;
      }
    };

    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      if (e.value && e.value.length > 0) {
        const text = e.value[0];
        if (currentTabRef.current === 'stt') {
          setTranscribedText(text);
        } else if (currentTabRef.current === 'voiceChat' && voiceChatActiveRef.current) {
          processVoiceChatInput(text);
        }
      }
    };

    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      if (e.value && e.value.length > 0) {
        const text = e.value[0];
        if (currentTabRef.current === 'stt') {
          setTranscribedText(text);
        } else if (currentTabRef.current === 'voiceChat' && voiceChatActiveRef.current) {
          setVoiceChatUserTranscript(text);
        }
      }
    };

    // 2. Initialize Text-To-Speech (Tts) engine
    Tts.getInitStatus()
      .then(
        () => {
          setTtsInitialized(true);
          loadTtsVoices();
        },
        (err) => {
          setDiagnosticError(`TTS Initialization failed: ${err.message || err}. Make sure Google Speech Services are active.`);
        }
      );

    const ttsStartListener = Tts.addEventListener('tts-start', () => setIsSpeaking(true));
    const ttsFinishListener = Tts.addEventListener('tts-finish', () => {
      setIsSpeaking(false);
      if (voiceChatStatusRef.current === 'speaking') {
        setVoiceChatStatus('idle');
      }
    });
    const ttsCancelListener = Tts.addEventListener('tts-cancel', () => {
      setIsSpeaking(false);
      if (voiceChatStatusRef.current === 'speaking') {
        setVoiceChatStatus('idle');
      }
    });
    const ttsErrorListener = Tts.addEventListener('tts-error', (err) => {
      setDiagnosticError(`TTS Engine error occurred during reading: ${String(err)}`);
      setIsSpeaking(false);
      if (voiceChatStatusRef.current === 'speaking') {
        setVoiceChatStatus('idle');
      }
    });

    // 3. Cleanup lifecycle on component unmount
    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
      Tts.stop();
      ttsStartListener.remove();
      ttsFinishListener.remove();
      ttsCancelListener.remove();
      ttsErrorListener.remove();
    };
  }, []);

  // --- CHECK DOWNLOADED MODELS ---
  const checkModelFiles = async () => {
    try {
      const status: {[key: string]: boolean} = {};
      for (const m of MODELS) {
        if (!m.isCloud) {
          const path = getModelPath(m.filename);
          status[m.id] = await RNFS.exists(path);
        }
      }
      setDownloadedModels(status);

      // Auto-load current model if it's already downloaded
      if (status[selectedModelId]) {
        initLlamaContext(selectedModelId);
      }
    } catch (err) {
      console.warn('Error checking model files:', err);
    }
  };

  // --- LOAD INSTALLED VOICES FROM DEVICE TTS ---
  const loadTtsVoices = async () => {
    try {
      const list = await Tts.voices();
      const filteredVoices: TTSVoice[] = list.map((v) => ({
        id: v.id,
        name: v.name,
        language: v.language,
        quality: v.quality,
        latency: v.latency,
        notInstalled: v.notInstalled,
      }));

      const installedVoices = filteredVoices.filter((v) => !v.notInstalled);
      setVoices(installedVoices);

      if (installedVoices.length > 0) {
        const defaultVoice = installedVoices.find((v) => v.language.startsWith('en')) || installedVoices[0];
        setSelectedVoice(defaultVoice.id);
        Tts.setDefaultVoice(defaultVoice.id);
      }
    } catch (err) {
      console.warn('[TTS load voices error]:', err);
    }
  };

  // --- LLAMA CONTEXT LOADER (WITH SAFE MEMORY RELEASE) ---
  const initLlamaContext = async (modelId: string) => {
    if (llamaContextRef.current && activeModelId === modelId) return;
    setIsLlamaInitializing(true);
    setLlamaInitialized(false);
    setDiagnosticError(null);

    // 1. Release previous model from native RAM before loading new one
    if (llamaContextRef.current) {
      try {
        console.log('Releasing Llama context:', activeModelId);
        await llamaContextRef.current.release();
      } catch (e) {
        console.warn('Error releasing previous llama context:', e);
      }
      llamaContextRef.current = null;
      setActiveModelId(null);
    }

    const model = MODELS.find(m => m.id === modelId);
    if (!model || model.isCloud) {
      setIsLlamaInitializing(false);
      return;
    }

    const path = getModelPath(model.filename);
    try {
      const exists = await RNFS.exists(path);
      if (!exists) {
        setIsLlamaInitializing(false);
        return;
      }
      console.log('Loading Llama model:', model.name, 'from:', path);
      const context = await initLlama({
        model: path,
        n_ctx: 1024,
        n_gpu_layers: 0, // safe CPU defaults for Android compatibility
      });
      llamaContextRef.current = context;
      setActiveModelId(modelId);
      setLlamaInitialized(true);
      console.log('Llama context initialized successfully for:', model.name);
    } catch (err: any) {
      console.error('Llama initialization failed:', err);
      setDiagnosticError(`Failed to load LLM (${model.name}): ${err.message || err}`);
    } finally {
      setIsLlamaInitializing(false);
    }
  };

  // --- DOWNLOAD MANAGER ---
  const startDownload = async (modelId: string) => {
    const model = MODELS.find(m => m.id === modelId);
    if (!model || model.isCloud) return;

    setDownloadingModelId(modelId);
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadProgress(0);
    setDownloadSpeed('0 MB/s');

    const path = getModelPath(model.filename);
    let lastTime = Date.now();
    let lastBytes = 0;

    try {
      const options = {
        fromUrl: model.url,
        toFile: path,
        begin: (res: any) => {
          setTotalSize((res.contentLength / (1024 * 1024)).toFixed(1) + ' MB');
        },
        progress: (res: any) => {
          const percent = Math.round((res.bytesWritten / res.contentLength) * 100);
          setDownloadProgress(percent);
          setDownloadedSize((res.bytesWritten / (1024 * 1024)).toFixed(1) + ' MB');

          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000; // seconds
          if (timeDiff >= 0.5) {
            const bytesDiff = res.bytesWritten - lastBytes;
            const speed = (bytesDiff / (1024 * 1024)) / timeDiff; // MB/s
            setDownloadSpeed(speed.toFixed(1) + ' MB/s');
            lastTime = now;
            lastBytes = res.bytesWritten;
          }
        },
        progressInterval: 500,
      };

      const result = RNFS.downloadFile(options);
      downloadJobId.current = result.jobId;

      const res = await result.promise;
      if (res.statusCode === 200) {
        setDownloadedModels(prev => ({ ...prev, [modelId]: true }));
        setIsDownloading(false);
        setDownloadingModelId(null);
        initLlamaContext(modelId);
      } else {
        throw new Error(`Server returned HTTP code ${res.statusCode}`);
      }
    } catch (err: any) {
      console.error('Download error:', err);
      setDownloadError(err.message || 'Download failed. Check your network.');
      setIsDownloading(false);
      setDownloadingModelId(null);
      // Clean up incomplete downloads
      try {
        const fileExists = await RNFS.exists(path);
        if (fileExists) {
          await RNFS.unlink(path);
        }
      } catch (cleanErr) {
        console.warn('Error deleting partial file:', cleanErr);
      }
    }
  };

  const cancelDownload = () => {
    if (downloadJobId.current !== null && downloadingModelId) {
      RNFS.stopDownload(downloadJobId.current);
      setIsDownloading(false);
      setDownloadProgress(0);
      const model = MODELS.find(m => m.id === downloadingModelId);
      if (model) {
        const path = getModelPath(model.filename);
        RNFS.unlink(path).catch(() => {});
      }
      setDownloadingModelId(null);
    }
  };

  // --- MODEL SELECTION HANDLER ---
  const handleModelSelect = (model: ModelOption) => {
    setModelDropdownVisible(false);
    setSearchQuery('');

    if (model.isCloud) {
      setDiagnosticError(`Cloud model '${model.name}' requires API connectivity. Please select a local offline model.`);
      return;
    }

    setSelectedModelId(model.id);

    // If already downloaded, initialize immediately
    if (downloadedModels[model.id]) {
      initLlamaContext(model.id);
    }
  };

  // --- TEXT CHAT INFERENCE ---
  const sendTextMessage = async () => {
    if (!chatInput.trim() || isAiThinking) return;
    if (!llamaContextRef.current) {
      setDiagnosticError('Local LLM is not loaded. Please wait or reload.');
      return;
    }

    const userInput = chatInput.trim();
    setChatInput('');

    // Add User Message
    const userMsg: ChatMessage = { id: Date.now().toString(), text: userInput, sender: 'user' };
    setChatMessages(prev => [...prev, userMsg]);

    // Add Placeholder AI Message
    const aiMsgId = (Date.now() + 1).toString();
    const aiMsgPlaceholder: ChatMessage = { id: aiMsgId, text: '', sender: 'ai' };
    setChatMessages(prev => [...prev, aiMsgPlaceholder]);

    setIsAiThinking(true);

    try {
      let completeText = '';
      const prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nYou are a helpful, extremely concise assistant. You must always answer in 1-2 short sentences.<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${userInput}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;

      await llamaContextRef.current.completion(
        {
          prompt: prompt,
          n_predict: 80,
          stop: ['<|eot_id|>', 'User:', 'Assistant:', '\nUser:', '\nAssistant:'],
          temperature: 0.7,
        },
        (data: any) => {
          completeText += data.token;
          setChatMessages(prev =>
            prev.map(m => m.id === aiMsgId ? { ...m, text: completeText } : m)
          );
        }
      );
    } catch (err: any) {
      console.error('Text Chat LLM error:', err);
      setChatMessages(prev =>
        prev.map(m => m.id === aiMsgId ? { ...m, text: `Error: ${err.message || err}` } : m)
      );
    } finally {
      setIsAiThinking(false);
    }
  };

  // --- VOICE CHAT ORCHESTRATION ---
  const startVoiceChatListening = async () => {
    const hasPermission = await checkMicrophonePermission();
    if (!hasPermission) {
      setDiagnosticError('Microphone permission denied. Cannot start Voice AI.');
      return;
    }

    await Tts.stop();
    setVoiceChatUserTranscript('Listening...');
    setVoiceChatAiResponse('');
    setVoiceChatStatus('listening');
    voiceChatActiveRef.current = true;

    try {
      await Voice.start(sttLocale);
    } catch (err: any) {
      console.error('Voice Chat STT error:', err);
      setDiagnosticError(`Failed to start recording: ${err.message || err}`);
      setVoiceChatStatus('idle');
      voiceChatActiveRef.current = false;
    }
  };

  const stopVoiceChatListening = async () => {
    if (!voiceChatActiveRef.current) return;
    try {
      await Voice.stop();
    } catch (err) {
      console.warn('Error stopping speech input:', err);
    }
  };

  const processVoiceChatInput = async (userInput: string) => {
    voiceChatActiveRef.current = false;
    if (!userInput.trim()) {
      setVoiceChatStatus('idle');
      return;
    }

    setVoiceChatUserTranscript(userInput);
    setVoiceChatStatus('thinking');

    if (!llamaContextRef.current) {
      setDiagnosticError('Local LLM is not loaded.');
      setVoiceChatStatus('idle');
      return;
    }

    try {
      const prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nYou are a helpful, extremely concise assistant. You must always answer in 1-2 short sentences.<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${userInput}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;

      const res = await llamaContextRef.current.completion({
        prompt: prompt,
        n_predict: 80,
        stop: ['<|eot_id|>', 'User:', 'Assistant:', '\nUser:', '\nAssistant:'],
        temperature: 0.7,
      });

      const responseText = res.text.trim();
      setVoiceChatAiResponse(responseText);

      // Speak out loud offline
      setVoiceChatStatus('speaking');
      await Tts.stop();
      await Tts.setDefaultRate(speechRate);
      await Tts.setDefaultPitch(speechPitch);
      if (selectedVoice) {
        await Tts.setDefaultVoice(selectedVoice);
      }
      Tts.speak(responseText);
    } catch (err: any) {
      console.error('Voice Chat LLM processing error:', err);
      setVoiceChatAiResponse(`Error: ${err.message || err}`);
      setVoiceChatStatus('idle');
    }
  };

  // --- STT MICROPHONE PULSING ANIMATION ---
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isListening) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 850,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 850,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }

    return () => {
      if (animation) animation.stop();
    };
  }, [isListening]);

  // --- VOICE ASSISTANT STATE PULSING ANIMATION ---
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (voiceChatStatus === 'listening' || voiceChatStatus === 'thinking' || voiceChatStatus === 'speaking') {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(voicePulseAnim, {
            toValue: 1.2,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(voicePulseAnim, {
            toValue: 1.0,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      voicePulseAnim.setValue(1);
    }

    return () => {
      if (animation) animation.stop();
    };
  }, [voiceChatStatus]);

  // --- READ TEXT ALOUD (Tab 2) ---
  const readTextAloud = async () => {
    if (!ttsInitialized) {
      setDiagnosticError('TTS Engine is not initialized yet. Please wait.');
      return;
    }
    if (!ttsInputText.trim()) {
      setDiagnosticError('TTS Input box is empty. Please enter some text to speak.');
      return;
    }

    setDiagnosticError(null);
    try {
      await Tts.stop();
      await Tts.setDefaultRate(speechRate);
      await Tts.setDefaultPitch(speechPitch);
      if (selectedVoice) {
        await Tts.setDefaultVoice(selectedVoice);
      }
      Tts.speak(ttsInputText);
    } catch (err: any) {
      setDiagnosticError(`TTS Playback failed: ${err.message || err}`);
    }
  };

  const getSelectedVoiceName = () => {
    const found = voices.find((v) => v.id === selectedVoice);
    if (!found) return 'Default Voice / Locale';
    return `${found.name} (${found.language})`;
  };

  // --- DOWNLOAD CARD COMPONENT ---
  const renderDownloadCard = () => (
    <View style={styles.downloadCard}>
      <Text style={styles.downloadTitle}>📥 Local AI Model Required</Text>
      <Text style={styles.downloadDesc}>
        To chat offline, please download the local model {selectedModel.name} ({selectedModel.size}).
        This file is saved entirely on your device for complete privacy and offline operation.
      </Text>

      {isDownloading && downloadingModelId === selectedModelId ? (
        <View style={styles.downloadProgressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressPct}>{downloadProgress}%</Text>
            <Text style={styles.progressSpeed}>{downloadSpeed}</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${downloadProgress}%` }]} />
          </View>
          <Text style={styles.progressSize}>
            {downloadedSize} / {totalSize || selectedModel.size}
          </Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelDownload}>
            <Text style={styles.cancelBtnText}>Cancel Download</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.downloadActionSection}>
          {downloadError && (
            <Text style={styles.downloadErrorText}>⚠️ {downloadError}</Text>
          )}
          <TouchableOpacity 
            style={styles.downloadBtn} 
            onPress={() => startDownload(selectedModelId)}
          >
            <Text style={styles.downloadBtnText}>Download Model ({selectedModel.size})</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // --- RENDER STT TAB (Tab 1) ---
  const renderSttTab = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🎙️ Voice-To-Text Settings</Text>
        <View style={styles.divider} />

        <Text style={styles.fieldLabel}>Voice-To-Text Locale (STT)</Text>
        <View style={styles.sttLocaleRow}>
          {[
            { label: 'English (US)', value: 'en-US' },
            { label: 'English (IN)', value: 'en-IN' },
            { label: 'Hindi (IN)', value: 'hi-IN' },
          ].map((locale) => (
            <TouchableOpacity
              key={locale.value}
              activeOpacity={0.8}
              style={[
                styles.segmentButton,
                sttLocale === locale.value && styles.segmentButtonActive,
              ]}
              onPress={() => setSttLocale(locale.value)}
            >
              <Text
                style={[
                  styles.segmentButtonText,
                  sttLocale === locale.value && styles.segmentButtonTextActive,
                ]}
              >
                {locale.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🎙️ Voice Recognition Control</Text>
        <View style={styles.divider} />

        <View style={styles.microphoneWrapper}>
          <Animated.View
            style={[
              styles.micPulseRing,
              {
                transform: [{ scale: pulseAnim }],
                backgroundColor: isListening ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.15)',
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              style={[
                styles.micButton,
                isListening ? styles.micButtonListening : styles.micButtonIdle,
              ]}
              onPress={isListening ? () => Voice.stop() : startVoiceChatListening}
            >
              <Text style={styles.micIconText}>🎤</Text>
            </TouchableOpacity>
          </Animated.View>
          <Text style={[styles.statusText, isListening && styles.statusListeningText]}>
            {isListening ? 'Listening for speech input...' : 'Tap Mic to Start Recognition'}
          </Text>
        </View>

        <Text style={styles.smallLabel}>Real-time Transcribed Output</Text>
        <View style={styles.transcriptionBox}>
          <ScrollView style={styles.transcriptScroll} nestedScrollEnabled={true}>
            {transcribedText ? (
              <Text style={styles.transcriptText}>{transcribedText}</Text>
            ) : (
              <Text style={styles.transcriptPlaceholder}>
                Press the microphone button and begin speaking. Your words will appear here...
              </Text>
            )}
          </ScrollView>
        </View>

        {transcribedText ? (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => setTranscribedText('')}
          >
            <Text style={styles.clearBtnText}>Clear Transcript</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ScrollView>
  );

  // --- RENDER TTS TAB (Tab 2) ---
  const renderTtsTab = () => (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.cardTitle}>⚙️ Vocalizer Voice Profiles</Text>
        <View style={styles.divider} />

        <View style={styles.sliderSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.fieldLabel}>TTS Speech Rate (Speed)</Text>
            <Text style={styles.sliderValueText}>{speechRate.toFixed(2)}x</Text>
          </View>
          <View style={styles.stepperContainer}>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => setSpeechRate(Math.max(0.1, speechRate - 0.05))}
            >
              <Text style={styles.stepperText}>-</Text>
            </TouchableOpacity>
            <View style={styles.trackContainer}>
              <View style={styles.trackBackground}>
                <View style={[styles.trackFill, { width: `${(speechRate / 2.0) * 100}%` }]} />
              </View>
            </View>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => setSpeechRate(Math.min(2.0, speechRate + 0.05))}
            >
              <Text style={styles.stepperText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sliderSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.fieldLabel}>TTS Voice Pitch</Text>
            <Text style={styles.sliderValueText}>{speechPitch.toFixed(2)}</Text>
          </View>
          <View style={styles.stepperContainer}>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => setSpeechPitch(Math.max(0.5, speechPitch - 0.1))}
            >
              <Text style={styles.stepperText}>-</Text>
            </TouchableOpacity>
            <View style={styles.trackContainer}>
              <View style={styles.trackBackground}>
                <View style={[styles.trackFill, { width: `${((speechPitch - 0.5) / 1.5) * 100}%` }]} />
              </View>
            </View>
            <TouchableOpacity
              style={styles.stepperButton}
              onPress={() => setSpeechPitch(Math.min(2.0, speechPitch + 0.1))}
            >
              <Text style={styles.stepperText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.fieldLabel}>Voice Profile</Text>
        <TouchableOpacity
          style={styles.selectorTrigger}
          activeOpacity={0.8}
          onPress={() => setVoiceListVisible(true)}
        >
          <Text style={styles.selectorTriggerText} numberOfLines={1}>
            {getSelectedVoiceName()}
          </Text>
          <Text style={styles.selectorTriggerChevron}>▼</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔊 Read Aloud (TTS)</Text>
        <View style={styles.divider} />

        <Text style={styles.fieldLabel}>Custom Vocalization Text</Text>
        <TextInput
          style={styles.textInput}
          multiline
          numberOfLines={3}
          value={ttsInputText}
          onChangeText={setTtsInputText}
          placeholder="Write words to synthesize..."
          placeholderTextColor="#64748B"
        />

        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.speakButton,
            isSpeaking ? styles.speakButtonSpeaking : styles.speakButtonIdle,
          ]}
          onPress={isSpeaking ? () => Tts.stop() : readTextAloud}
        >
          {isSpeaking ? (
            <View style={styles.speakButtonRow}>
              <ActivityIndicator size="small" color="#FFFFFF" style={styles.loadingMargin} />
              <Text style={styles.speakButtonText}>Stop Synthesis</Text>
            </View>
          ) : (
            <Text style={styles.speakButtonText}>Read Text Aloud</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // --- RENDER CHAT TAB (Tab 3) ---
  const renderChatTab = () => {
    if (!downloadedModels[selectedModelId]) {
      return (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {renderDownloadCard()}
        </ScrollView>
      );
    }

    if (isLlamaInitializing) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Loading Llama Context into RAM...</Text>
        </View>
      );
    }

    return (
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={styles.chatHeader}>
          <View style={styles.dotActive} />
          <Text style={styles.chatHeaderStatus}>
            Local {selectedModel.name} Active (Offline)
          </Text>
        </View>

        <FlatList
          ref={chatFlatListRef}
          data={chatMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chatListContent}
          onContentSizeChange={() => chatFlatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[
              styles.chatBubbleContainer,
              item.sender === 'user' ? styles.chatBubbleUserAlign : styles.chatBubbleAiAlign
            ]}>
              <View style={[
                styles.chatBubble,
                item.sender === 'user' ? styles.chatBubbleUser : styles.chatBubbleAi
              ]}>
                {item.text === '' && isAiThinking && item.sender === 'ai' ? (
                  <View style={styles.thinkingDots}>
                    <ActivityIndicator size="small" color="#818CF8" />
                    <Text style={styles.thinkingDotsText}> typing...</Text>
                  </View>
                ) : (
                  <Text style={styles.chatBubbleText}>{item.text}</Text>
                )}
              </View>
            </View>
          )}
        />

        {/* Modern chat input bar representing provided design reference */}
        <View style={styles.chatInputContainerModern}>
          <TextInput
            style={styles.chatInputModern}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder={`Message ${selectedModel.name}...`}
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={2}
          />
          <View style={styles.chatToolbarModern}>
            <View style={styles.toolbarLeft}>
              <TouchableOpacity style={styles.toolbarBtn}>
                <Text style={styles.toolbarBtnText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.toolbarBtn}>
                <Text style={styles.toolbarBtnText}>🌐</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.toolbarRight}>
              <TouchableOpacity
                style={styles.modelPillBtn}
                onPress={() => setModelDropdownVisible(true)}
                disabled={isDownloading}
              >
                <Text style={styles.modelPillText}>{selectedModel.name}</Text>
                <Text style={styles.modelPillChevron}>▼</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.chatSendBtnCircle, (!chatInput.trim() || isAiThinking) && styles.chatSendBtnCircleDisabled]}
                onPress={sendTextMessage}
                disabled={!chatInput.trim() || isAiThinking}
              >
                <Text style={styles.chatSendBtnCircleText}>↑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  };

  // --- RENDER VOICE CHAT ASSISTANT (Tab 4) ---
  const renderVoiceChatTab = () => {
    if (!downloadedModels[selectedModelId]) {
      return (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {renderDownloadCard()}
        </ScrollView>
      );
    }

    if (isLlamaInitializing) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Loading Llama Context into RAM...</Text>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.voiceChatScroll} keyboardShouldPersistTaps="handled">
        {/* Model Selector pill visible inside voice chat */}
        <View style={styles.voiceModelRow}>
          <Text style={styles.voiceModelLabel}>Active LLM:</Text>
          <TouchableOpacity
            style={styles.modelPillBtn}
            onPress={() => setModelDropdownVisible(true)}
            disabled={isDownloading}
          >
            <Text style={styles.modelPillText}>{selectedModel.name}</Text>
            <Text style={styles.modelPillChevron}>▼</Text>
          </TouchableOpacity>
        </View>

        {/* Ambient Visualizer */}
        <View style={styles.voiceAssistantWrapper}>
          <Animated.View style={[
            styles.voiceOuterGlow,
            {
              transform: [{ scale: voicePulseAnim }],
              backgroundColor:
                voiceChatStatus === 'listening' ? 'rgba(239, 68, 68, 0.18)' :
                voiceChatStatus === 'thinking' ? 'rgba(99, 102, 241, 0.18)' :
                voiceChatStatus === 'speaking' ? 'rgba(217, 70, 239, 0.18)' :
                'rgba(30, 41, 59, 0.3)'
            }
          ]}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[
                styles.voiceCenterBtn,
                voiceChatStatus === 'listening' ? styles.voiceBtnListening :
                voiceChatStatus === 'thinking' ? styles.voiceBtnThinking :
                voiceChatStatus === 'speaking' ? styles.voiceBtnSpeaking :
                styles.voiceBtnIdle
              ]}
              onPress={
                voiceChatStatus === 'listening' ? stopVoiceChatListening :
                voiceChatStatus === 'speaking' ? () => Tts.stop() :
                startVoiceChatListening
              }
            >
              {voiceChatStatus === 'listening' ? (
                <Text style={styles.voiceCenterIcon}>🛑</Text>
              ) : voiceChatStatus === 'thinking' ? (
                <ActivityIndicator size="large" color="#FFFFFF" />
              ) : voiceChatStatus === 'speaking' ? (
                <Text style={styles.voiceCenterIcon}>🔊</Text>
              ) : (
                <Text style={styles.voiceCenterIcon}>🎤</Text>
              )}
            </TouchableOpacity>
          </Animated.View>

          <Text style={[
            styles.voiceAssistantStatusText,
            voiceChatStatus === 'listening' && styles.statusListeningText,
            voiceChatStatus === 'thinking' && styles.statusThinkingText,
            voiceChatStatus === 'speaking' && styles.statusSpeakingText
          ]}>
            {voiceChatStatus === 'idle' && 'Tap Mic to Start Talking'}
            {voiceChatStatus === 'listening' && 'Listening... Speak now'}
            {voiceChatStatus === 'thinking' && 'Thinking offline...'}
            {voiceChatStatus === 'speaking' && 'AI Responding...'}
          </Text>
        </View>

        {/* User and AI transcripts display */}
        <View style={styles.voiceTranscriptCard}>
          <Text style={styles.smallLabel}>Voice Dialogue</Text>
          <View style={styles.divider} />
          
          <Text style={styles.voiceDialogLabel}>You Said:</Text>
          <Text style={styles.voiceUserText}>
            {voiceChatUserTranscript || '(Speech input will appear here)'}
          </Text>

          <View style={styles.voiceSpacer} />

          <Text style={styles.voiceDialogLabel}>AI Response:</Text>
          <Text style={styles.voiceAiText}>
            {voiceChatAiResponse || '(AI voice reply will appear here)'}
          </Text>
        </View>

        {/* Collapsible Voice Settings Panel */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.voiceSettingsToggle}
            onPress={() => setVoiceSettingsVisible(!voiceSettingsVisible)}
          >
            <Text style={styles.cardTitle}>⚙️ AI Vocal Settings</Text>
            <Text style={styles.selectorTriggerChevron}>
              {voiceSettingsVisible ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>

          {voiceSettingsVisible && (
            <View style={styles.voiceSettingsContent}>
              <View style={styles.divider} />

              <View style={styles.sliderSection}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.fieldLabel}>Voice Speech Rate (Speed)</Text>
                  <Text style={styles.sliderValueText}>{speechRate.toFixed(2)}x</Text>
                </View>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setSpeechRate(Math.max(0.1, speechRate - 0.05))}
                  >
                    <Text style={styles.stepperText}>-</Text>
                  </TouchableOpacity>
                  <View style={styles.trackContainer}>
                    <View style={styles.trackBackground}>
                      <View style={[styles.trackFill, { width: `${(speechRate / 2.0) * 100}%` }]} />
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setSpeechRate(Math.min(2.0, speechRate + 0.05))}
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.sliderSection}>
                <View style={styles.sliderHeader}>
                  <Text style={styles.fieldLabel}>Voice Pitch</Text>
                  <Text style={styles.sliderValueText}>{speechPitch.toFixed(2)}</Text>
                </View>
                <View style={styles.stepperContainer}>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setSpeechPitch(Math.max(0.5, speechPitch - 0.1))}
                  >
                    <Text style={styles.stepperText}>-</Text>
                  </TouchableOpacity>
                  <View style={styles.trackContainer}>
                    <View style={styles.trackBackground}>
                      <View style={[styles.trackFill, { width: `${((speechPitch - 0.5) / 1.5) * 100}%` }]} />
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.stepperButton}
                    onPress={() => setSpeechPitch(Math.min(2.0, speechPitch + 0.1))}
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Voice Profile</Text>
              <TouchableOpacity
                style={styles.selectorTrigger}
                activeOpacity={0.8}
                onPress={() => setVoiceListVisible(true)}
              >
                <Text style={styles.selectorTriggerText} numberOfLines={1}>
                  {getSelectedVoiceName()}
                </Text>
                <Text style={styles.selectorTriggerChevron}>▼</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  // --- BOTTOM TAB BAR ---
  const renderTabBar = () => (
    <View style={styles.tabBar}>
      <TouchableOpacity
        style={[styles.tabItem, currentTab === 'stt' && styles.tabItemActive]}
        onPress={() => { setCurrentTab('stt'); Tts.stop(); }}
      >
        <Text style={styles.tabIcon}>🎙️</Text>
        <Text style={[styles.tabLabel, currentTab === 'stt' && styles.tabLabelActive]}>STT</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tabItem, currentTab === 'tts' && styles.tabItemActive]}
        onPress={() => { setCurrentTab('tts'); Tts.stop(); }}
      >
        <Text style={styles.tabIcon}>🔊</Text>
        <Text style={[styles.tabLabel, currentTab === 'tts' && styles.tabLabelActive]}>TTS</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tabItem, currentTab === 'chat' && styles.tabItemActive]}
        onPress={() => { setCurrentTab('chat'); Tts.stop(); }}
      >
        <Text style={styles.tabIcon}>💬</Text>
        <Text style={[styles.tabLabel, currentTab === 'chat' && styles.tabLabelActive]}>AI Chat</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.tabItem, currentTab === 'voiceChat' && styles.tabItemActive]}
        onPress={() => { setCurrentTab('voiceChat'); Tts.stop(); }}
      >
        <Text style={styles.tabIcon}>🤖</Text>
        <Text style={[styles.tabLabel, currentTab === 'voiceChat' && styles.tabLabelActive]}>Voice AI</Text>
      </TouchableOpacity>
    </View>
  );

  // Filter model list based on search
  const filteredModels = MODELS.filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />

      {/* HEADER BANNER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AcousticLab</Text>
        <Text style={styles.headerSubtitle}>
          {currentTab === 'stt' && 'Voice to Text (STT)'}
          {currentTab === 'tts' && 'Text to Voice (TTS)'}
          {currentTab === 'chat' && 'Local AI Chat (Offline)'}
          {currentTab === 'voiceChat' && 'Voice AI Assistant (Offline)'}
        </Text>
      </View>

      {/* DIAGNOSTIC ERROR BANNER */}
      {diagnosticError && (
        <View style={styles.errorBanner}>
          <View style={styles.errorIconContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
          </View>
          <View style={styles.errorTextContainer}>
            <Text style={styles.errorBannerTitle}>System Diagnostic Alert</Text>
            <Text style={styles.errorBannerText}>{diagnosticError}</Text>
          </View>
          <TouchableOpacity onPress={() => setDiagnosticError(null)} style={styles.errorCloseBtn}>
            <Text style={styles.errorCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* RENDER CHOSEN VIEW */}
      <View style={styles.mainContentWrapper}>
        {currentTab === 'stt' && renderSttTab()}
        {currentTab === 'tts' && renderTtsTab()}
        {currentTab === 'chat' && renderChatTab()}
        {currentTab === 'voiceChat' && renderVoiceChatTab()}
      </View>

      {/* BOTTOM TAB BAR */}
      {renderTabBar()}

      {/* MODEL SELECTION DROPDOWN MODAL */}
      <Modal
        visible={modelDropdownVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModelDropdownVisible(false)}
      >
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setModelDropdownVisible(false)}
        >
          <View style={styles.dropdownCard}>
            {/* Search Input */}
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Find model..."
                placeholderTextColor="#64748B"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {/* List of Models representing the design in user request */}
            <ScrollView style={styles.modelListScroll}>
              {filteredModels.map((item) => {
                const isDownloaded = downloadedModels[item.id];
                const isCloud = item.isCloud;
                const isActive = selectedModelId === item.id;

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.modelItem, isActive && styles.modelItemActive]}
                    onPress={() => handleModelSelect(item)}
                  >
                    <Text style={[styles.modelItemText, isActive && styles.modelItemTextActive]}>
                      {item.name}
                    </Text>
                    
                    {isCloud ? (
                      <Text style={styles.cloudIcon}>☁️</Text>
                    ) : !isDownloaded ? (
                      <Text style={styles.downloadIconSmall}>📥</Text>
                    ) : (
                      isActive && <Text style={styles.checkmarkIconSmall}>✓</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* TTS VOICES SELECTION MODAL */}
      <Modal
        visible={voiceListVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setVoiceListVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose TTS Engine Profile</Text>
              <TouchableOpacity onPress={() => setVoiceListVisible(false)}>
                <Text style={styles.modalCloseText}>Done</Text>
              </TouchableOpacity>
            </View>

            {voices.length === 0 ? (
              <View style={styles.modalEmpty}>
                <ActivityIndicator size="large" color="#6366F1" />
                <Text style={styles.modalEmptyText}>Scanning devices voices...</Text>
              </View>
            ) : (
              <FlatList
                data={voices}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.voiceItem,
                      selectedVoice === item.id && styles.voiceItemActived,
                    ]}
                    onPress={() => {
                      setSelectedVoice(item.id);
                      Tts.setDefaultVoice(item.id);
                    }}
                  >
                    <View style={styles.voiceItemDetails}>
                      <Text style={styles.voiceItemName}>{item.name}</Text>
                      <Text style={styles.voiceItemLang}>Locale: {item.language}</Text>
                    </View>
                    {selectedVoice === item.id && (
                      <Text style={styles.checkmarkIcon}>✓</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// --- PREMIUM DESIGN STYLESHEET (GLASSMORPHISM / DARK THEME) ---
const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  header: {
    paddingVertical: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6366F1',
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  mainContentWrapper: {
    flex: 1,
    paddingBottom: 72, // Room for absolute tab bar
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 20,
  },
  card: {
    backgroundColor: 'rgba(30, 41, 59, 0.45)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 18,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 12,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
    marginBottom: 8,
  },
  smallLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sttLocaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  segmentButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  segmentButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: '#6366F1',
  },
  segmentButtonText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  segmentButtonTextActive: {
    color: '#818CF8',
    fontWeight: '700',
  },
  sliderSection: {
    marginBottom: 18,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sliderValueText: {
    color: '#6366F1',
    fontWeight: '700',
    fontSize: 14,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  stepperText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  trackContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  trackBackground: {
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 3,
  },
  selectorTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  selectorTriggerText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 10,
  },
  selectorTriggerChevron: {
    color: '#64748B',
    fontSize: 12,
  },
  microphoneWrapper: {
    alignItems: 'center',
    marginVertical: 14,
  },
  micPulseRing: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
  micButtonIdle: {
    backgroundColor: '#6366F1',
  },
  micButtonListening: {
    backgroundColor: '#EF4444',
  },
  micIconText: {
    fontSize: 28,
  },
  statusText: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  statusListeningText: {
    color: '#EF4444',
  },
  statusThinkingText: {
    color: '#6366F1',
  },
  statusSpeakingText: {
    color: '#D946EF',
  },
  transcriptionBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 14,
    height: 120,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  transcriptScroll: {
    flex: 1,
  },
  transcriptText: {
    color: '#E2E8F0',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  transcriptPlaceholder: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  clearBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    padding: 12,
    color: '#FFFFFF',
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  speakButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakButtonIdle: {
    backgroundColor: '#6366F1',
  },
  speakButtonSpeaking: {
    backgroundColor: '#D946EF',
  },
  speakButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  speakButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingMargin: {
    marginRight: 8,
  },
  errorBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    borderColor: 'rgba(244, 63, 94, 0.3)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
  },
  errorIconContainer: {
    marginRight: 10,
  },
  errorIcon: {
    fontSize: 18,
  },
  errorTextContainer: {
    flex: 1,
  },
  errorBannerTitle: {
    color: '#FDA4AF',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorBannerText: {
    color: '#FECDD3',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 16,
  },
  errorCloseBtn: {
    padding: 6,
    marginLeft: 6,
  },
  errorCloseText: {
    color: '#FDA4AF',
    fontSize: 14,
    fontWeight: '600',
  },

  // --- DOWNLOAD UI STYLES ---
  downloadCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.45)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 24,
    alignItems: 'center',
    marginVertical: 24,
  },
  downloadTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  downloadDesc: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  downloadProgressSection: {
    width: '100%',
    alignItems: 'center',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 8,
  },
  progressPct: {
    color: '#818CF8',
    fontWeight: '800',
    fontSize: 16,
  },
  progressSpeed: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 14,
  },
  progressBarBg: {
    height: 12,
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 6,
  },
  progressSize: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 16,
  },
  cancelBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  cancelBtnText: {
    color: '#F87171',
    fontWeight: '700',
    fontSize: 13,
  },
  downloadActionSection: {
    width: '100%',
    alignItems: 'center',
  },
  downloadErrorText: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  downloadBtn: {
    backgroundColor: '#6366F1',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    elevation: 4,
    shadowColor: '#6366F1',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  downloadBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },

  // --- GENERAL LOADER STYLES ---
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B0F19',
  },
  loadingText: {
    marginTop: 16,
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
  },

  // --- TEXT CHAT STYLES ---
  chatContainer: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  dotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  chatHeaderStatus: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  chatListContent: {
    padding: 16,
    paddingBottom: 24,
  },
  chatBubbleContainer: {
    marginVertical: 6,
    flexDirection: 'row',
    width: '100%',
  },
  chatBubbleUserAlign: {
    justifyContent: 'flex-end',
  },
  chatBubbleAiAlign: {
    justifyContent: 'flex-start',
  },
  chatBubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    elevation: 1,
  },
  chatBubbleUser: {
    backgroundColor: '#4F46E5',
    borderBottomRightRadius: 4,
  },
  chatBubbleAi: {
    backgroundColor: 'rgba(30, 41, 59, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderBottomLeftRadius: 4,
  },
  chatBubbleText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  thinkingDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thinkingDotsText: {
    color: '#818CF8',
    fontStyle: 'italic',
    fontSize: 13,
  },

  // --- MODERN INPUT CONTAINER AND TOOLBAR STYLES ---
  chatInputContainerModern: {
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chatInputModern: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
    minHeight: 50,
    maxHeight: 120,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  chatToolbarModern: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  toolbarBtnText: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: 'bold',
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelPillBtn: {
    flexDirection: 'row',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
    marginRight: 12,
  },
  modelPillText: {
    color: '#818CF8',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 6,
  },
  modelPillChevron: {
    color: '#818CF8',
    fontSize: 10,
  },
  chatSendBtnCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  chatSendBtnCircleDisabled: {
    backgroundColor: '#1E293B',
    opacity: 0.5,
  },
  chatSendBtnCircleText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },

  // --- MODEL DROPDOWN MODAL OVERLAY STYLES ---
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    width: '80%',
    maxHeight: '60%',
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  searchContainer: {
    marginBottom: 10,
  },
  searchInput: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  modelListScroll: {
    flexGrow: 0,
  },
  modelItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginVertical: 2,
  },
  modelItemActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  modelItemText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },
  modelItemTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  cloudIcon: {
    fontSize: 14,
    color: '#64748B',
  },
  downloadIconSmall: {
    fontSize: 14,
    color: '#6366F1',
  },
  checkmarkIconSmall: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: 'bold',
  },

  // --- VOICE CHAT ASSISTANT STYLES ---
  voiceChatScroll: {
    padding: 16,
    paddingBottom: 30,
  },
  voiceModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(30, 41, 59, 0.3)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
  },
  voiceModelLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  voiceAssistantWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  voiceOuterGlow: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceCenterBtn: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  voiceBtnIdle: {
    backgroundColor: '#6366F1',
  },
  voiceBtnListening: {
    backgroundColor: '#EF4444',
  },
  voiceBtnThinking: {
    backgroundColor: '#4F46E5',
  },
  voiceBtnSpeaking: {
    backgroundColor: '#D946EF',
  },
  voiceCenterIcon: {
    fontSize: 42,
    color: '#FFFFFF',
  },
  voiceAssistantStatusText: {
    marginTop: 18,
    fontSize: 16,
    fontWeight: '700',
    color: '#94A3B8',
  },
  voiceTranscriptCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    padding: 16,
    marginBottom: 20,
  },
  voiceDialogLabel: {
    fontSize: 11,
    color: '#6366F1',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  voiceUserText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  voiceAiText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  voiceSpacer: {
    height: 16,
  },
  voiceSettingsToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  voiceSettingsContent: {
    marginTop: 4,
  },

  // --- TAB BAR STYLES ---
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 10,
    justifyContent: 'space-around',
    alignItems: 'center',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  tabItemActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  tabLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#818CF8',
    fontWeight: '700',
  },

  // --- MODAL SELECTOR STYLES ---
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '65%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCloseText: {
    color: '#6366F1',
    fontWeight: '700',
    fontSize: 14,
  },
  modalEmpty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  modalEmptyText: {
    color: '#94A3B8',
    marginTop: 12,
    fontSize: 13,
  },
  voiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
  },
  voiceItemActived: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderRadius: 8,
  },
  voiceItemDetails: {
    flex: 1,
  },
  voiceItemName: {
    fontSize: 14,
    color: '#F1F5F9',
    fontWeight: '600',
  },
  voiceItemLang: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  checkmarkIcon: {
    color: '#6366F1',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
