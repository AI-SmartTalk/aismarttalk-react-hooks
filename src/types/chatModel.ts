export interface ChatModel {
    id: string;
    name: string;
    description: string;
    adminDescription: string;
    lang: string;
    type: string;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    theme: Record<string, string>;
    organizationId: string;
    userId: string;
    user: {
      id: string;
      name: string;
      email: string | null;
      emailVerified: boolean | null;
      lang: string;
      image: string;
      createdAt: string;
      updatedAt: string;
      archived: boolean;
      role: string;
    };
  }
  