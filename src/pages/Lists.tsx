import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface List {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  item_count: number;
  checked_count: number;
}

const Lists = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchLists();
  }, [user, navigate]);

  const fetchLists = async () => {
    try {
      const { data, error } = await supabase
        .from('lists')
        .select(`
          id,
          name,
          created_at,
          updated_at
        `)
        .eq('archived', false)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      // Get item counts separately
      const listsWithCounts = await Promise.all(
        (data || []).map(async (list) => {
          const { data: items } = await supabase
            .from('list_items')
            .select('id, checked')
            .eq('list_id', list.id);

          return {
            id: list.id,
            name: list.name,
            created_at: list.created_at,
            updated_at: list.updated_at,
            item_count: items?.length || 0,
            checked_count: items?.filter(item => item.checked).length || 0,
          };
        })
      );

      setLists(listsWithCounts);
    } catch (error) {
      console.error('Error fetching lists:', error);
      toast.error('Failed to fetch lists');
    } finally {
      setLoading(false);
    }
  };

  const createNewList = async () => {
    try {
      const { data, error } = await supabase
        .from('lists')
        .insert({ user_id: user!.id, name: 'New List' })
        .select()
        .single();

      if (error) throw error;

      navigate(`/lists/${data.id}`);
    } catch (error) {
      console.error('Error creating list:', error);
      toast.error('Failed to create list');
    }
  };

  const deleteList = async (listId: string) => {
    try {
      const { error } = await supabase
        .from('lists')
        .update({ archived: true })
        .eq('id', listId);

      if (error) throw error;

      setLists(lists.filter(list => list.id !== listId));
      toast.success('List archived');
    } catch (error) {
      console.error('Error archiving list:', error);
      toast.error('Failed to archive list');
    }
  };

  const duplicateList = async (listId: string) => {
    try {
      const { data: originalList, error: listError } = await supabase
        .from('lists')
        .select('name')
        .eq('id', listId)
        .single();

      if (listError) throw listError;

      const { data: newList, error: createError } = await supabase
        .from('lists')
        .insert({ 
          user_id: user!.id, 
          name: `${originalList.name} (Copy)` 
        })
        .select()
        .single();

      if (createError) throw createError;

      const { data: items, error: itemsError } = await supabase
        .from('list_items')
        .select('name, aisle, quantity, notes, position')
        .eq('list_id', listId);

      if (itemsError) throw itemsError;

      if (items && items.length > 0) {
        const newItems = items.map(item => ({
          ...item,
          list_id: newList.id,
          user_id: user!.id,
        }));

        const { error: insertError } = await supabase
          .from('list_items')
          .insert(newItems);

        if (insertError) throw insertError;
      }

      toast.success('List duplicated');
      fetchLists();
    } catch (error) {
      console.error('Error duplicating list:', error);
      toast.error('Failed to duplicate list');
    }
  };

  const filteredLists = lists.filter(list =>
    list.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <CheckSquare className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
          <p className="text-muted-foreground">Loading your lists...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-8 w-8 text-primary" />
            <h1 className="text-xl font-bold">Checklister</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">My Lists</h2>
              <p className="text-muted-foreground">
                {lists.length === 0 ? 'No lists yet' : `${lists.length} list${lists.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <Button onClick={createNewList} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Create New List
            </Button>
          </div>

          {lists.length > 0 && (
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search lists..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button 
                variant="outline" 
                onClick={() => navigate('/create')}
                className="whitespace-nowrap"
              >
                Import from Text/Photo
              </Button>
            </div>
          )}

          {filteredLists.length === 0 ? (
            <div className="text-center py-12">
              <CheckSquare className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {lists.length === 0 ? 'Create your first list' : 'No lists found'}
              </h3>
              <p className="text-muted-foreground mb-6">
                {lists.length === 0 
                  ? 'Start by creating a list manually or importing from text or photos'
                  : 'Try adjusting your search or create a new list'
                }
              </p>
              {lists.length === 0 && (
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button onClick={createNewList}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create New List
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/create')}>
                    Import from Text/Photo
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredLists.map((list) => (
                <Card key={list.id} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1" onClick={() => navigate(`/lists/${list.id}`)}>
                        <CardTitle className="text-lg leading-tight">{list.name}</CardTitle>
                        <CardDescription className="mt-1">
                          Updated {formatDistanceToNow(new Date(list.updated_at), { addSuffix: true })}
                        </CardDescription>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/lists/${list.id}`)}>
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicateList(list.id)}>
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => deleteList(list.id)}
                            className="text-destructive"
                          >
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent onClick={() => navigate(`/lists/${list.id}`)}>
                    <div className="flex items-center gap-4">
                      <Badge variant="secondary">
                        {list.item_count} item{list.item_count === 1 ? '' : 's'}
                      </Badge>
                      {list.checked_count > 0 && (
                        <Badge variant="outline">
                          {list.checked_count} completed
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Lists;