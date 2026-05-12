-- Add text_content column for text/joke bits
alter table public.bits add column if not exists text_content text;

-- media_url is now nullable (text bits don't need it)
alter table public.bits alter column media_url drop not null;

-- Update media_type check to match client types
alter table public.bits drop constraint if exists bits_media_type_check;
alter table public.bits add constraint bits_media_type_check
  check (media_type in ('text', 'youtube', 'image', 'audio', 'video'));
