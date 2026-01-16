import { useState } from 'react';
import { Download } from 'lucide-react';
import { aiRuntimeApi } from '@/services/api';

interface ExcelDownloadButtonProps {
    agentId: string;
    sql: string;
    iconOnly?: boolean;
}

export const ExcelDownloadButton = ({ agentId, sql, iconOnly = false }: ExcelDownloadButtonProps) => {
    const [downloading, setDownloading] = useState(false);

    const handleDownload = async () => {
        setDownloading(true);

        try {
            const res = await aiRuntimeApi.post('/api/query/export-excel',
                { agent_id: agentId, sql },
                { responseType: 'blob' }
            );

            // Create download link
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `query-results-${Date.now()}.xlsx`;
            document.body.appendChild(a);
            a.click();

            // Cleanup
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            alert('Failed to download Excel file. Please try again.');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <button
            onClick={handleDownload}
            disabled={downloading}
            className={
                iconOnly
                    ? "p-2 text-green-600 hover:bg-green-50 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    : "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            }
            title={downloading ? 'Downloading...' : 'Download Excel'}
        >
            <Download className="w-4 h-4" />
            {!iconOnly && (downloading ? 'Downloading...' : 'Download Excel')}
        </button>
    );
};
