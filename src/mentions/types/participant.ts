export interface CommandRegistration {
  name: string;
  description: string;
}

export interface ParticipantRegistration {
  id: string;
  name: string;
  fullName: string;
  description: string;
  isSticky?: boolean;
  commands?: CommandRegistration[];
  detectionExamples?: string[];
}

export interface IMentionRegistry {
  register(participant: ParticipantRegistration): void;
  resolve(name: string): ParticipantRegistration | undefined;
  detectParticipant(prompt: string): ParticipantRegistration | undefined;
  list(): ParticipantRegistration[];
}
