const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  'https://krmvgrfwoanzajlsvjvm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtybXZncmZ3b2FuemFqbHN2anZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjEzNjQwNywiZXhwIjoyMDkxNzEyNDA3fQ.3ANzFQXj_xxzMuQE2Evh8yCmKp4FifStzBNIEXrakIQ'
)

async function atualizarUsuario() {
  const { data, error } = await supabase.auth.admin.updateUserById(
    'f83f2edb-ec98-4b9f-b49d-3ca1ae807e05',
    {
      password: 'Facundo.123',
      email_confirm: true
    }
  )

  if (error) {
    console.error(error)
    return
  }

  console.log('Usuário atualizado com sucesso!')
}

atualizarUsuario()