import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://krmvgrfwoanzajlsvjvm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtybXZncmZ3b2FuemFqbHN2anZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjEzNjQwNywiZXhwIjoyMDkxNzEyNDA3fQ.3ANzFQXj_xxzMuQE2Evh8yCmKp4FifStzBNIEXrakIQ'
)

const { data, error } = await supabase.auth.admin.updateUserById(
  'd0bdd7af-4f79-4eef-9486-492c5f9c031a',
  {
    password: 'recepcao.123'
  }
)

if (error) {
  console.error(error)
} else {
  console.log('✅ Senha alterada com sucesso!')
}