import { useState } from 'react'
import { Copy, Check, Code2, Palette } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import toast from 'react-hot-toast'

interface EmbeddingSnippetsProps {
  agentId: string
  apiKey: string
}

export function EmbeddingSnippets({ agentId, apiKey }: EmbeddingSnippetsProps) {
  const [activeTab, setActiveTab] = useState<'iframe' | 'javascript' | 'react'>('iframe')
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null)
  const [customization, setCustomization] = useState({
    height: '600px',
    primaryColor: '#4f46e5',
    backgroundColor: '#ffffff',
  })

  const baseUrl = window.location.origin
  const embedUrl = `${baseUrl}/embed?agentId=${agentId}&apiKey=${apiKey}&height=${encodeURIComponent(customization.height)}&primaryColor=${encodeURIComponent(customization.primaryColor)}&backgroundColor=${encodeURIComponent(customization.backgroundColor)}&v=${Math.random().toString(36).substring(7)}`

  const iframeSnippet = `<iframe
  src="${embedUrl}"
  width="100%"
  height="${customization.height}"
  frameborder="0"
  allow="clipboard-write"
  style="border: none; border-radius: 8px;"
></iframe>`

  const javascriptSnippet = `<!-- Add this where you want the chat to appear -->
<div id="ai-chat"></div>

<!-- Add this before closing </body> tag -->
<script>
  (function() {
    const iframe = document.createElement('iframe');
    iframe.src = '${embedUrl}';
    iframe.width = '100%';
    iframe.height = '${customization.height}';
    iframe.frameBorder = '0';
    iframe.allow = 'clipboard-write';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';

    document.getElementById('ai-chat').appendChild(iframe);
  })();
</script>`

  const reactSnippet = `import { useEffect, useRef } from 'react';

export default function AIChatWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const iframe = document.createElement('iframe');
    iframe.src = '${embedUrl}';
    iframe.width = '100%';
    iframe.height = '${customization.height}';
    iframe.frameBorder = '0';
    iframe.allow = 'clipboard-write';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';

    containerRef.current.appendChild(iframe);

    return () => {
      if (containerRef.current?.contains(iframe)) {
        containerRef.current.removeChild(iframe);
      }
    };
  }, []);

  return <div ref={containerRef} />;
}`

  const snippets = {
    iframe: iframeSnippet,
    javascript: javascriptSnippet,
    react: reactSnippet,
  }

  const handleCopy = (snippet: string, type: string) => {
    navigator.clipboard.writeText(snippet)
    setCopiedSnippet(type)
    toast.success('Copied to clipboard')
    setTimeout(() => setCopiedSnippet(null), 2000)
  }

  const tabs = [
    { id: 'iframe' as const, label: 'HTML/iframe' },
    { id: 'javascript' as const, label: 'JavaScript' },
    { id: 'react' as const, label: 'React' },
  ]

  return (
    <div className="space-y-6">
      {/* Customization Controls */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Palette className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          <h4 className="font-semibold text-slate-900 dark:text-slate-100">Customization</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Height
            </label>
            <input
              type="text"
              value={customization.height}
              onChange={(e) => setCustomization({ ...customization, height: e.target.value })}
              placeholder="600px"
              className="input w-full"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              e.g., 600px, 100vh, 80%
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Primary Color
            </label>
            <div className="flex space-x-2">
              <input
                type="color"
                value={customization.primaryColor}
                onChange={(e) => setCustomization({ ...customization, primaryColor: e.target.value })}
                className="h-10 w-16 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
              />
              <input
                type="text"
                value={customization.primaryColor}
                onChange={(e) => setCustomization({ ...customization, primaryColor: e.target.value })}
                className="input flex-1"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Background Color
            </label>
            <div className="flex space-x-2">
              <input
                type="color"
                value={customization.backgroundColor}
                onChange={(e) => setCustomization({ ...customization, backgroundColor: e.target.value })}
                className="h-10 w-16 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
              />
              <input
                type="text"
                value={customization.backgroundColor}
                onChange={(e) => setCustomization({ ...customization, backgroundColor: e.target.value })}
                className="input flex-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Code Snippets */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center px-6 py-3">
            <Code2 className="w-5 h-5 text-slate-600 dark:text-slate-400 mr-2" />
            <h4 className="font-semibold text-slate-900 dark:text-slate-100">Integration Code</h4>
          </div>

          {/* Tabs */}
          <div className="flex space-x-1 px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Code Display */}
        <div className="relative">
          <div className="absolute top-3 right-3 z-10">
            <button
              type="button"
              onClick={() => handleCopy(snippets[activeTab], activeTab)}
              className="btn btn-sm bg-slate-700 hover:bg-slate-600 text-white flex items-center space-x-2"
            >
              {copiedSnippet === activeTab ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          <SyntaxHighlighter
            language={activeTab === 'react' ? 'tsx' : activeTab === 'javascript' ? 'html' : 'html'}
            style={oneDark}
            customStyle={{
              margin: 0,
              borderRadius: 0,
              padding: '1.5rem',
              fontSize: '0.875rem',
              maxHeight: '400px',
            }}
            wrapLongLines
          >
            {snippets[activeTab]}
          </SyntaxHighlighter>
        </div>
      </div>

      {/* Live Preview */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700">
          <h4 className="font-semibold text-slate-900 dark:text-slate-100">Live Preview</h4>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            This is how the embedded chat will appear on your website
          </p>
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-900/50">
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <iframe
              src={embedUrl}
              width="100%"
              height={customization.height}
              frameBorder="0"
              allow="clipboard-write"
              style={{ border: 'none' }}
              title="Chat Preview"
            />
          </div>
        </div>
      </div>

      {/* Security Notice */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h5 className="font-medium text-blue-900 dark:text-blue-100 text-sm mb-2">
          🔒 Security Notice
        </h5>
        <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
          <li>Your API key is included in the embed URL - keep it secure</li>
          <li>API keys can be revoked at any time if compromised</li>
          <li>All requests are tracked and can be monitored in the audit logs</li>
          <li>The API key grants access only to this specific agent</li>
        </ul>
      </div>
    </div>
  )
}
