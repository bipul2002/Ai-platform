import { api } from './api'

export const messagesApi = {
    getResults: (messageId: string, page: number = 1, pageSize: number = 10) =>
        api.get(`/messages/${messageId}/results`, {
            params: { page, pageSize }
        }),

    downloadExcel: async (messageId: string) => {
        const response = await api.get(`/messages/${messageId}/export/excel`, {
            responseType: 'blob'
        });

        // Create download link
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `query-results-${messageId.substring(0, 8)}.xlsx`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    }
}
