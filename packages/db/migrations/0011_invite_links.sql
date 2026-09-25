-- Convite por link (sem e-mail): e-mail passa a ser opcional e o convite ganha um apelido
-- para identificação na lista. Alteração aditiva; convites existentes continuam válidos.
alter table invites alter column email drop not null;
alter table invites add column label text check (label is null or length(label) <= 80);
-- Proprietário só por convite nominal (com e-mail).
alter table invites add constraint invites_owner_requires_email check (role <> 'owner' or email is not null);
